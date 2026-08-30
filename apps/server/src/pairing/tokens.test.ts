import { createHmac } from "node:crypto";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeSessionCount,
  consumePairingNonce,
  generatePairingToken,
  generateSessionCredential,
  initSessionStore,
  MAX_ACTIVE_SESSIONS,
  resetSessionStoreForTests,
  revokeAllSessions,
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
    // after pairing: only the /api/pair handshake itself is single-use.
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

describe("multi-device sessions", () => {
  beforeEach(() => {
    revokeAllSessions();
  });

  it("keeps both devices valid, so the iPad and the laptop mirror coexist", () => {
    // This is the product requirement: the iPad holds the pen and the laptop
    // shows a read-only mirror, so pairing the second must not evict the
    // first. The previous single-active-session model failed exactly here.
    const ipad = generateSessionCredential();
    const laptop = generateSessionCredential();

    expect(verifySessionCredential(ipad)).toBe(true);
    expect(verifySessionCredential(laptop)).toBe(true);
  });

  it("keeps every credential valid up to the cap", () => {
    const credentials = Array.from({ length: MAX_ACTIVE_SESSIONS }, () =>
      generateSessionCredential(),
    );

    expect(credentials.map((c) => verifySessionCredential(c))).toEqual(
      credentials.map(() => true),
    );
    expect(activeSessionCount()).toBe(MAX_ACTIVE_SESSIONS);
  });

  it("evicts the oldest credential once the cap is exceeded", () => {
    const oldest = generateSessionCredential();
    for (let i = 0; i < MAX_ACTIVE_SESSIONS; i += 1) {
      generateSessionCredential();
    }

    // Dropping the least recently paired device is preferable to refusing to
    // pair and locking the operator out of their own board.
    expect(verifySessionCredential(oldest)).toBe(false);
    expect(activeSessionCount()).toBe(MAX_ACTIVE_SESSIONS);
  });

  it("revokeAllSessions invalidates every outstanding credential at once", () => {
    const ipad = generateSessionCredential();
    const laptop = generateSessionCredential();
    expect(verifySessionCredential(ipad)).toBe(true);

    revokeAllSessions();

    expect(verifySessionCredential(ipad)).toBe(false);
    expect(verifySessionCredential(laptop)).toBe(false);
    expect(activeSessionCount()).toBe(0);
  });

  it("does not resurrect a credential revoked before a later pairing", () => {
    const stale = generateSessionCredential();
    revokeAllSessions();
    generateSessionCredential();

    expect(verifySessionCredential(stale)).toBe(false);
  });

  it("rejects a credential missing the generation field, old-shape payloads fail closed", () => {
    const payload = { sessionNonce: "abc123", issuedAt: Date.now() };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.PAIRING_TOKEN_SECRET!)
      .update(`session.${payloadB64}`)
      .digest("hex");
    expect(verifySessionCredential(`session.${payloadB64}.${signature}`)).toBe(false);
  });

  it("rejects a tampered generation even with an otherwise-valid signature target", () => {
    // Bumping `generation` in the decoded payload without re-signing must
    // still be caught by the HMAC check, not just the equality check.
    const valid = generateSessionCredential();
    const [prefix, payloadB64, signature] = valid.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64 ?? "", "base64url").toString());
    const tampered = { ...decoded, generation: decoded.generation + 1 };
    const tamperedB64 = Buffer.from(JSON.stringify(tampered)).toString("base64url");
    expect(verifySessionCredential(`${prefix}.${tamperedB64}.${signature}`)).toBe(false);
  });
});

describe("session persistence across restarts", () => {
  // The two-device setup used to be impossible to complete. Exactly one
  // pairing token was minted at boot, and /api/pair consumes a nonce
  // single-use, so whichever device scanned first burned it. The only way to
  // get another QR was to restart the server, and a restart wiped the
  // in-memory session store, un-pairing the device that had just succeeded.
  // These tests pin both halves of the fix.
  let storePath: string;

  beforeEach(() => {
    storePath = join(mkdtempSync(join(tmpdir(), "inkboard-sessions-")), "sessions.json");
    resetSessionStoreForTests();
  });

  it("mints an independent token per device, so both devices can pair", () => {
    const iPadToken = generatePairingToken();
    const laptopToken = generatePairingToken();
    expect(iPadToken).not.toBe(laptopToken);

    // The iPad pairs first and burns its own nonce...
    expect(consumePairingNonce(iPadToken)).toBe(true);
    // ...which must not invalidate the laptop's separate token.
    expect(consumePairingNonce(laptopToken)).toBe(true);
  });

  it("keeps a credential valid after the process restarts", () => {
    initSessionStore(storePath);
    const credential = generateSessionCredential();
    expect(verifySessionCredential(credential)).toBe(true);

    // Simulate a restart: drop all in-memory state, then reload from disk.
    resetSessionStoreForTests();
    expect(verifySessionCredential(credential)).toBe(false);

    initSessionStore(storePath);
    expect(verifySessionCredential(credential)).toBe(true);
  });

  it("keeps both devices paired across a restart", () => {
    initSessionStore(storePath);
    const iPad = generateSessionCredential();
    const laptop = generateSessionCredential();

    resetSessionStoreForTests();
    initSessionStore(storePath);

    expect(verifySessionCredential(iPad)).toBe(true);
    expect(verifySessionCredential(laptop)).toBe(true);
    expect(activeSessionCount()).toBe(2);
  });

  it("still honours an explicit revoke across a restart", () => {
    initSessionStore(storePath);
    const credential = generateSessionCredential();
    revokeAllSessions();

    resetSessionStoreForTests();
    initSessionStore(storePath);

    expect(verifySessionCredential(credential)).toBe(false);
  });

  it("tolerates a corrupt store rather than refusing to start", () => {
    writeFileSync(storePath, "{not json");
    expect(() => initSessionStore(storePath)).not.toThrow();
  });

  it("keeps the store private even if a stale temp file was world-readable", () => {
    // writeFileSync's `mode` only applies when it creates the file, so a
    // leftover permissive temp file from an earlier run would carry its own
    // mode straight through the rename and publish the session nonces to
    // every local user. persistSessions() chmods explicitly to prevent that.
    writeFileSync(`${storePath}.${process.pid}.tmp`, "stale", { mode: 0o644 });
    chmodSync(`${storePath}.${process.pid}.tmp`, 0o644);

    initSessionStore(storePath);
    generateSessionCredential();

    expect(statSync(storePath).mode & 0o777).toBe(0o600);
  });
});
