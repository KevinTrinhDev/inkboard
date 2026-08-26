import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generatePairingToken, generateSessionCredential } from "../pairing/tokens.js";
import { registerUploadRoute } from "./uploadRoute.js";

let recordingsDir: string;
let app: FastifyInstance;

beforeAll(() => {
  process.env.PAIRING_TOKEN_SECRET = "test-secret-not-for-real-use";
});

beforeEach(async () => {
  recordingsDir = await mkdtemp(join(tmpdir(), "inkboard-upload-test-"));
  process.env.RECORDINGS_DIR = recordingsDir;
  app = Fastify();
  await registerUploadRoute(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(recordingsDir, { recursive: true, force: true });
});

describe("POST /api/sessions/:id/upload", () => {
  it("rejects a missing pairing token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/abc-123/upload",
      payload: Buffer.from("data"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid pairing token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/abc-123/upload",
      headers: { "x-pairing-token": "garbage" },
      payload: Buffer.from("data"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a session id containing a path traversal segment", async () => {
    const token = generateSessionCredential();
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/..%2F..%2Fetc%2Fpasswd/upload",
      headers: { "x-pairing-token": token },
      payload: Buffer.from("data"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a session id with an embedded slash even URL-decoded", async () => {
    const token = generateSessionCredential();
    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${encodeURIComponent("../evil")}/upload`,
      headers: { "x-pairing-token": token },
      payload: Buffer.from("data"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid token and session id, storing the raw body byte-for-byte", async () => {
    const token = generateSessionCredential();
    const body = Buffer.from("fake-encrypted-bytes-not-real-video");
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/session-42/upload",
      headers: { "x-pairing-token": token, "content-type": "application/octet-stream" },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const stored = await readFile(join(recordingsDir, "session-42.webm.enc"));
    expect(stored.equals(body)).toBe(true);
  });

  it("rejects a short-lived pairing token used as the upload credential", async () => {
    // The 5-minute pairing token authenticates the /api/pair handshake only
    // — uploads (which may arrive long after an offline session) require the
    // separate long-lived session credential.
    const token = generatePairingToken();
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/session-42/upload",
      headers: { "x-pairing-token": token },
      payload: Buffer.from("data"),
    });
    expect(res.statusCode).toBe(401);
  });
});
