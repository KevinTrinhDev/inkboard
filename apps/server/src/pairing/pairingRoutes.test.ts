import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generatePairingToken } from "./tokens.js";
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

  it("rejects the same token pairing twice — single-use handshake", async () => {
    const token = generatePairingToken();
    const first = await app.inject({ method: "POST", url: "/api/pair", payload: { token } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "POST", url: "/api/pair", payload: { token } });
    expect(second.statusCode).toBe(401);
  });
});
