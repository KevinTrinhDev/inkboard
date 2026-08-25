import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { consumePairingNonce, generatePairingToken, verifyPairingToken } from "./tokens.js";

beforeAll(() => {
  process.env.PAIRING_TOKEN_SECRET = "test-secret-not-for-real-use";
});

describe("verifyPairingToken", () => {
  it("accepts a freshly generated token", () => {
    const token = generatePairingToken();
    expect(verifyPairingToken(token)).toBe(true);
  });

  it("rejects an expired token", () => {
    const payload = { nonce: "abc123", issuedAt: Date.now() - 6 * 60 * 1000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.PAIRING_TOKEN_SECRET!)
      .update(payloadB64)
      .digest("hex");
    expect(verifyPairingToken(`${payloadB64}.${signature}`)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = generatePairingToken();
    const [payloadB64] = token.split(".");
    expect(verifyPairingToken(`${payloadB64}.${"0".repeat(64)}`)).toBe(false);
  });

  it("rejects a validly-signed but malformed (non-JSON) payload", () => {
    // Regression test for a real crash found by hand: a signed-but-garbage
    // payload used to throw inside JSON.parse and take the request down
    // with it (uncaught exception -> 500 / abnormal WS close).
    const payloadB64 = Buffer.from("not json").toString("base64url");
    const signature = createHmac("sha256", process.env.PAIRING_TOKEN_SECRET!)
      .update(payloadB64)
      .digest("hex");
    expect(() => verifyPairingToken(`${payloadB64}.${signature}`)).not.toThrow();
    expect(verifyPairingToken(`${payloadB64}.${signature}`)).toBe(false);
  });

  it("rejects a garbage string with no separator", () => {
    expect(verifyPairingToken("not-a-token")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(verifyPairingToken("")).toBe(false);
  });
});

describe("consumePairingNonce", () => {
  it("accepts a fresh token once", () => {
    const token = generatePairingToken();
    expect(consumePairingNonce(token)).toBe(true);
  });

  it("rejects the same token on a second pairing attempt", () => {
    const token = generatePairingToken();
    expect(consumePairingNonce(token)).toBe(true);
    expect(consumePairingNonce(token)).toBe(false);
  });

  it("still lets verifyPairingToken succeed after the nonce is consumed", () => {
    // The token keeps working as the bearer credential for uploads/signaling
    // after pairing — only the /api/pair handshake itself is single-use.
    const token = generatePairingToken();
    consumePairingNonce(token);
    expect(verifyPairingToken(token)).toBe(true);
  });

  it("rejects an invalid token without throwing", () => {
    expect(consumePairingNonce("garbage")).toBe(false);
  });
});
