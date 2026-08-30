import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
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

/**
 * M0 stand-in for live capture: the client records locally via
 * MediaRecorder and uploads the blob when the operator stops recording.
 * Live WebRTC capture is M1: see docs/ROADMAP.md.
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
    // Reject anything that isn't a bare UUID-like segment before it ever
    // touches the filesystem path.
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return reply.code(400).send({ error: "invalid session id" });
    }

    // Bodies arrive pre-encrypted client-side (AES-256-GCM, IV prepended):
    // this server never holds the key, so `.enc` reflects what's actually on
    // disk: ciphertext, not a playable video file. See docs/SECURITY.md
    // "Encryption at rest".
    const filePath = join(recordingsDir, `${id}.webm.enc`);
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
      await unlink(filePath).catch(() => {
        // Best effort: nothing more to do if this also fails.
      });
      request.log.error({ err, sessionId: id }, "upload failed, partial file removed");
      return reply.code(502).send({ error: "upload failed, please retry" });
    }

    return reply.send({ stored: true, path: filePath });
  });
}
