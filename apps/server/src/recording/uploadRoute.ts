import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { verifySessionCredential } from "../pairing/tokens.js";
import { resolveRecordingsDir } from "../paths.js";

// Defense in depth alongside Caddy's own `request_body { max_size }`: this
// route can also be hit directly against the Fastify port during local
// dev/testing, so it shouldn't rely solely on the reverse proxy in front of
// it to bound upload size.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, matches Caddyfile

// The ciphertext file name never reveals the real container; the container
// rides in a tiny plaintext sidecar so the recording device (the only one
// with the key) can decrypt into the right format for playback/YouTube.
const ENC_SUFFIX = ".webm.enc";
const META_SUFFIX = ".json";
// Upload ids kept as lenient as before (existing clients/tests use
// arbitrary ids); the read-back API below insists on real UUIDs.
const SESSION_ID_RE = /^[a-zA-Z0-9-]+$/;
const TAKE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN_MIMES = new Set(["video/webm", "video/mp4"]);

interface TakeMeta {
  id: string;
  mime: string;
  bytes: number;
  at: string;
}

/**
 * Recording ingest and the "my takes" API that lets the recording device
 * list and fetch its own ciphertext, which it alone can decrypt (the key
 * never leaves that browser). See docs/SECURITY.md "Encryption at rest".
 */
export async function registerUploadRoute(app: FastifyInstance) {
  // Resolved through paths.ts so this agrees with app.ts; the two used to
  // default to different directories relative to cwd.
  const recordingsDir = resolve(resolveRecordingsDir());
  await mkdir(recordingsDir, { recursive: true });

  // MediaRecorder blobs arrive as video/webm (or similar), not JSON/text.
  // Fastify 415s any content-type it has no parser for by default. This
  // passes the raw stream through untouched so the handler can pipe
  // `request.raw` itself instead of Fastify buffering it into request.body.
  app.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });

  app.post("/api/sessions/:id/upload", async (request, reply) => {
    const token = (request.headers["x-pairing-token"] as string) ?? "";
    if (!verifySessionCredential(token)) {
      return reply.code(401).send({ error: "invalid or expired session credential" });
    }

    const { id } = request.params as { id: string };
    // Reject anything that isn't a bare UUID segment before it ever touches
    // the filesystem path.
    if (!SESSION_ID_RE.test(id)) {
      return reply.code(400).send({ error: "invalid session id" });
    }

    // The container of the *plaintext* take, sent by the recording device;
    // stored in the sidecar so playback knows whether it is WebM or MP4.
    const rawMime = (request.headers["x-take-mime"] as string | undefined) ?? "";
    const mime = KNOWN_MIMES.has(rawMime) ? rawMime : "video/webm";

    // Bodies arrive pre-encrypted client-side (AES-256-GCM, IV prepended):
    // this server never holds the key, so `.enc` reflects what's actually on
    // disk: ciphertext, not a playable video file. See docs/SECURITY.md
    // "Encryption at rest".
    const filePath = join(recordingsDir, `${id}${ENC_SUFFIX}`);
    if (!filePath.startsWith(recordingsDir + sep)) {
      return reply.code(400).send({ error: "invalid session id" });
    }

    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: "upload too large" });
    }

    const fileStream = createWriteStream(filePath);
    let bytesWritten = 0;
    request.raw.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        request.raw.destroy(new Error("upload exceeded size limit"));
      }
    });

    try {
      await pipeline(request.raw, fileStream);
    } catch (err) {
      // Never leave a truncated/corrupt file behind that a later listing or
      // playback attempt could mistake for a complete recording.
      await unlink(filePath).catch(() => {});
      request.log.error({ err, sessionId: id }, "upload failed, partial file removed");
      return reply.code(502).send({ error: "upload failed, please retry" });
    }

    const meta: TakeMeta = { id, mime, bytes: bytesWritten, at: new Date().toISOString() };
    await writeFile(join(recordingsDir, `${id}${META_SUFFIX}`), JSON.stringify(meta), {
      encoding: "utf8",
      mode: 0o600,
    });

    return reply.send({ stored: true, path: filePath });
  });

  // ------------------------------------------------------------------
  // "My takes": list + fetch, authenticated with the same session
  // credential the upload used. Only metadata and ciphertext move here;
  // decryption happens in the browser that holds the key.
  // ------------------------------------------------------------------
  app.get("/api/takes", async (request, reply) => {
    const token = (request.headers["x-pairing-token"] as string) ?? "";
    if (!verifySessionCredential(token)) {
      return reply.code(401).send({ error: "invalid or expired session credential" });
    }
    const files = await readdir(recordingsDir);
    const takes: TakeMeta[] = [];
    for (const name of files) {
      if (!name.endsWith(ENC_SUFFIX)) continue;
      const id = name.slice(0, -ENC_SUFFIX.length);
      try {
        const raw = await readFile(join(recordingsDir, `${id}${META_SUFFIX}`), "utf8");
        takes.push(JSON.parse(raw) as TakeMeta);
      } catch {
        // No sidecar (older takes): surface what we know from the file.
        takes.push({ id, mime: "video/webm", bytes: 0, at: "" });
      }
    }
    takes.sort((a, b) => b.at.localeCompare(a.at));
    return reply.send({ takes });
  });

  app.get<{ Params: { id: string } }>("/api/takes/:id", async (request, reply) => {
    const token = (request.headers["x-pairing-token"] as string) ?? "";
    if (!verifySessionCredential(token)) {
      return reply.code(401).send({ error: "invalid or expired session credential" });
    }
    const { id } = request.params;
    if (!TAKE_ID_RE.test(id)) {
      return reply.code(400).send({ error: "invalid take id" });
    }
    const filePath = join(recordingsDir, `${id}${ENC_SUFFIX}`);
    if (!filePath.startsWith(recordingsDir + sep)) {
      return reply.code(400).send({ error: "invalid take id" });
    }
    try {
      const stat = await import("node:fs/promises").then((m) => m.stat(filePath));
      reply
        .header("content-type", "application/octet-stream")
        .header("content-length", stat.size)
        .header("x-content-type-options", "nosniff");
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: "no such take" });
    }
  });
}
