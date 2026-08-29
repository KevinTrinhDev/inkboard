import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { generateSessionCredential } from "../pairing/tokens.js";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" + "01f15c489",
  "hex",
);

describe("asset routes", () => {
  let app: FastifyInstance;
  let dir: string;
  let clientDist: string;
  let credential: string;

  beforeAll(async () => {
    process.env.PAIRING_TOKEN_SECRET = "test-secret-not-for-real-use";
    dir = mkdtempSync(join(tmpdir(), "inkboard-assets-"));
    clientDist = mkdtempSync(join(tmpdir(), "inkboard-dist-"));
    writeFileSync(join(clientDist, "index.html"), "<!doctype html>");

    app = await buildApp({
      clientDist,
      assetsDir: join(dir, "assets"),
      boardStatePath: join(dir, "board.json"),
    });
    await app.ready();
    credential = generateSessionCredential();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(clientDist, { recursive: true, force: true });
  });

  async function upload(contentType: string, body: Buffer, token = credential) {
    return app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { "content-type": contentType, authorization: `Bearer ${token}` },
      payload: body,
    });
  }

  it("stores an image and serves it back with the right type", async () => {
    const res = await upload("image/png", PNG);
    expect(res.statusCode).toBe(201);

    const { src, id } = res.json();
    expect(src).toBe(`/api/assets/${id}`);

    // This round trip is the whole feature: an image pasted on the laptop is
    // fetchable by the iPad from a URL both devices share.
    const fetched = await app.inject({ method: "GET", url: src });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");
    expect(fetched.rawPayload.equals(PNG)).toBe(true);
  });

  it("refuses an upload with no credential", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { "content-type": "image/png" },
      payload: PNG,
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an upload with an invalid credential", async () => {
    const res = await upload("image/png", PNG, "session.forged.credential");
    expect(res.statusCode).toBe(401);
  });

  it("rejects SVG, which would be a stored-XSS vector on the board", async () => {
    const res = await upload("image/svg+xml", Buffer.from("<svg onload=alert(1)>"));
    expect(res.statusCode).toBe(415);
  });

  it("rejects an arbitrary executable content type", async () => {
    const res = await upload("text/html", Buffer.from("<script>alert(1)</script>"));
    expect(res.statusCode).toBe(415);
  });

  it("sets nosniff so a renderer cannot reinterpret the bytes", async () => {
    const { src } = (await upload("image/png", PNG)).json();
    const fetched = await app.inject({ method: "GET", url: src });
    expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rejects a traversal attempt in the asset id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/assets/..%2f..%2f..%2fetc%2fpasswd",
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s an id that is well-formed but absent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/assets/00000000-0000-4000-8000-000000000000.png",
    });
    expect(res.statusCode).toBe(404);
  });

  it("gives each upload a distinct id so one paste cannot clobber another", async () => {
    const first = (await upload("image/png", PNG)).json();
    const second = (await upload("image/png", PNG)).json();
    expect(first.id).not.toBe(second.id);
  });
});
