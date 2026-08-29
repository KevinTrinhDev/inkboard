import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { verifySessionCredential } from "../pairing/tokens.js";

/**
 * Images pasted on the laptop have to reach the iPad, so the bytes live on
 * the server and both devices reference them by id. Without this an image
 * would be a local blob: URL that exists on exactly one device and renders as
 * a broken shape on the other.
 */
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

/**
 * Allowlist rather than blocklist. These are served back to a browser, so the
 * set is restricted to formats that render as media and cannot execute:
 * notably no SVG, which is script-capable and would be a stored-XSS vector
 * against the board itself.
 */
const ALLOWED: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value;
}

export async function registerAssetRoutes(
  app: FastifyInstance,
  assetsDir: string,
): Promise<void> {
  const root = resolve(assetsDir);
  await mkdir(root, { recursive: true });

  app.post("/api/assets", async (request, reply) => {
    const token = bearer(request.headers.authorization);
    if (!token || !verifySessionCredential(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const contentType = (request.headers["content-type"] ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const extension = contentType ? ALLOWED[contentType] : undefined;
    if (!extension) {
      return reply
        .code(415)
        .send({ error: "unsupported media type", accepted: Object.keys(ALLOWED) });
    }

    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > MAX_ASSET_BYTES) {
      return reply.code(413).send({ error: "asset too large" });
    }

    const id = `${randomUUID()}${extension}`;
    const filePath = join(root, id);

    let written = 0;
    let overflowed = false;
    request.raw.on("data", (chunk: Buffer) => {
      written += chunk.length;
      // A chunked upload has no content-length, so the declared check above
      // is bypassable and this streaming counter is the real limit.
      if (written > MAX_ASSET_BYTES && !overflowed) {
        overflowed = true;
        request.raw.destroy(new Error("asset exceeded size limit"));
      }
    });

    try {
      await pipeline(request.raw, createWriteStream(filePath));
    } catch {
      await unlink(filePath).catch(() => {});
      if (overflowed) return reply.code(413).send({ error: "asset too large" });
      return reply.code(502).send({ error: "upload failed, please retry" });
    }

    app.log.info({ id, bytes: written }, "asset stored");
    return reply.code(201).send({ id, src: `/api/assets/${id}` });
  });

  app.get<{ Params: { id: string } }>("/api/assets/:id", async (request, reply) => {
    const { id } = request.params;

    // The id is server-generated (uuid + known extension). Anything else is
    // rejected outright rather than being resolved and path-checked.
    if (!/^[0-9a-f-]{36}\.[a-z0-9]{3,4}$/i.test(id)) {
      return reply.code(400).send({ error: "bad asset id" });
    }

    const filePath = join(root, id);
    if (!resolve(filePath).startsWith(root + sep) || !existsSync(filePath)) {
      return reply.code(404).send({ error: "not found" });
    }

    const extension = extname(id).toLowerCase();
    const type = Object.entries(ALLOWED).find(([, ext]) => ext === extension)?.[0];
    if (!type) return reply.code(404).send({ error: "not found" });

    const info = await stat(filePath);
    // Immutable: the id is unique per upload, so the bytes behind it never
    // change and the iPad can cache aggressively over a slow AP.
    reply
      .header("content-type", type)
      .header("content-length", info.size)
      .header("cache-control", "private, max-age=31536000, immutable")
      // Belt and braces against a renderer sniffing something executable.
      .header("x-content-type-options", "nosniff");

    return reply.send(createReadStream(filePath));
  });
}
