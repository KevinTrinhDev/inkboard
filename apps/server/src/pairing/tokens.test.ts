import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  consumePairingNonce,
  generatePairingToken,
  generateSessionCredential,
  verifyPairingToken,
  verifySessionCredential,
} from "./tokens.js";

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

describe("verifySessionCredential", () => {
  it("accepts a freshly generated session credential", () => {
    expect(verifySessionCredential(generateSessionCredential())).toBe(true);
  });

  it("rejects a credential older than 30 days", () => {
    const payload = { sessionNonce: "abc123", issuedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.PAIRING_TOKEN_SECRET!)
      .update(`session.${payloadB64}`)
      .digest("hex");
    expect(verifySessionCredential(`session.${payloadB64}.${signature}`)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = generateSessionCredential();
    const [prefix, payloadB64] = token.split(".");
    expect(verifySessionCredential(`${prefix}.${payloadB64}.${"0".repeat(64)}`)).toBe(false);
  });

  it("rejects a validly-signed but malformed (non-JSON) payload", () => {
    const payloadB64 = Buffer.from("not json").toString("base64url");
    const signature = createHmac("sha256", process.env.PAIRING_TOKEN_SECRET!)
      .update(`session.${payloadB64}`)
      .digest("hex");
    expect(() => verifySessionCredential(`session.${payloadB64}.${signature}`)).not.toThrow();
    expect(verifySessionCredential(`session.${payloadB64}.${signature}`)).toBe(false);
  });

  it("rejects a garbage string with no separators", () => {
    expect(verifySessionCredential("not-a-token")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(verifySessionCredential("")).toBe(false);
  });

  it("does not accept a pairing token's signature as a session credential", () => {
    // The `session.` domain-separator on the HMAC input means a pairing
    // token's payload/signature pair can't be reused as a session
    // credential even though both are signed with the same secret.
    const pairingToken = generatePairingToken();
    const [payloadB64, pairingSignature] = pairingToken.split(".");
    expect(verifySessionCredential(`session.${payloadB64}.${pairingSignature}`)).toBe(false);
  });

  it("does not accept a session credential's signature as a pairing token", () => {
    const sessionCredential = generateSessionCredential();
    const [, payloadB64, sessionSignature] = sessionCredential.split(".");
    expect(verifyPairingToken(`${payloadB64}.${sessionSignature}`)).toBe(false);
  });
});
