import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { verifyPairingToken } from "../pairing/tokens.js";

/**
 * M0 stand-in for live capture: the client records locally via
 * MediaRecorder and uploads the blob when the operator stops recording.
 * Live WebRTC capture is M1 — see docs/ROADMAP.md.
 */
export async function registerUploadRoute(app: FastifyInstance) {
  const recordingsDir = resolve(process.env.RECORDINGS_DIR ?? "./recordings");
  await mkdir(recordingsDir, { recursive: true });

  // MediaRecorder blobs arrive as video/webm (or similar), not JSON/text —
  // Fastify 415s any content-type it has no parser for by default. This
  // passes the raw stream through untouched so the handler can pipe
  // `request.raw` itself instead of Fastify buffering it into request.body.
  app.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });

  app.post("/api/sessions/:id/upload", async (request, reply) => {
    const token = (request.headers["x-pairing-token"] as string) ?? "";
    if (!verifyPairingToken(token)) {
      return reply.code(401).send({ error: "invalid or expired pairing token" });
    }

    const { id } = request.params as { id: string };
    // Reject anything that isn't a bare UUID-like segment before it ever
    // touches the filesystem path.
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return reply.code(400).send({ error: "invalid session id" });
    }

    const filePath = join(recordingsDir, `${id}.webm`);
    if (!filePath.startsWith(recordingsDir + sep)) {
      return reply.code(400).send({ error: "invalid session id" });
    }

    const fileStream = createWriteStream(filePath);
    await pipeline(request.raw, fileStream);

    return reply.send({ stored: true, path: filePath });
  });
}
