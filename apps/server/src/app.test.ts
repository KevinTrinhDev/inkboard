import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

/**
 * The startup QR encodes /pair?token=..., which used to 404 because the SPA
 * is served as static files and no /pair asset exists. That broke the only
 * documented way to pair a device, so these assertions guard the rewrite.
 */
describe("SPA fallback", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the SPA shell at the URL the pairing QR encodes", async () => {
    const res = await app.inject({ method: "GET", url: "/pair?token=abc123" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the SPA shell for an arbitrary client-side route", async () => {
    const res = await app.inject({ method: "GET", url: "/board" });
    expect(res.statusCode).toBe(200);
  });

  it("still 404s unknown API routes as JSON rather than HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("does not turn a non-GET into the SPA shell", async () => {
    const res = await app.inject({ method: "POST", url: "/pair" });
    expect(res.statusCode).toBe(404);
  });

  it("keeps /healthz working", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
