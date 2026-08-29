import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generatePairingToken, verifySessionCredential } from "./tokens.js";
import { pairingRoutes } from "./pairingRoutes.js";

let app: FastifyInstance;

beforeAll(() => {
  process.env.PAIRING_TOKEN_SECRET = "test-secret-not-for-real-use";
});

beforeEach(async () => {
  app = Fastify();
  await app.register(pairingRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("POST /api/pair", () => {
  it("rejects a request with no body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/pair" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with an empty token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pair",
      payload: { token: "" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pair",
      payload: { token: "not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid token and returns a session credential", async () => {
    const token = generatePairingToken();
    const res = await app.inject({
      method: "POST",
      url: "/api/pair",
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.paired).toBe(true);
    // The issued credential must be the distinct long-lived session
    // credential, never the short-lived pairing token itself.
    expect(body.credential).not.toBe(token);
    expect(body.credential.startsWith("session.")).toBe(true);
  });

  it("rejects the same token pairing twice: single-use handshake", async () => {
    const token = generatePairingToken();
    const first = await app.inject({ method: "POST", url: "/api/pair", payload: { token } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "POST", url: "/api/pair", payload: { token } });
    expect(second.statusCode).toBe(401);
  });

  it("lets a second device pair without kicking the first one off", async () => {
    const firstPairingToken = generatePairingToken();
    const firstRes = await app.inject({
      method: "POST",
      url: "/api/pair",
      payload: { token: firstPairingToken },
    });
    const firstCredential = firstRes.json().credential;
    expect(verifySessionCredential(firstCredential)).toBe(true);

    const secondPairingToken = generatePairingToken();
    const secondRes = await app.inject({
      method: "POST",
      url: "/api/pair",
      payload: { token: secondPairingToken },
    });
    const secondCredential = secondRes.json().credential;

    // The iPad draws and the laptop mirrors, so both have to hold a live
    // credential at the same time. This previously asserted the opposite,
    // back when pairing a second device silently revoked the first.
    expect(verifySessionCredential(firstCredential)).toBe(true);
    expect(verifySessionCredential(secondCredential)).toBe(true);
  });
});
