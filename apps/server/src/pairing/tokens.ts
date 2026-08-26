import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, HMAC-signed pairing tokens. A device that presents a valid,
 * unexpired token is considered paired — this is the actual authorization
 * gate, not "is on the same Wi-Fi." See docs/SECURITY.md.
 */

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes to scan the QR
// Long enough that a fully offline recording session (no Wi-Fi at all until
// the operator is back near the server) can still sync afterward without
// re-pairing. See docs/SECURITY.md "Offline recording".
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PairingToken {
  nonce: string;
  issuedAt: number;
}

export interface SessionCredential {
  sessionNonce: string;
  issuedAt: number;
}

// Nonces consumed by the /api/pair handshake, so a captured token can't be
// replayed to re-run pairing even inside its TTL. Not checked by
// verifyPairingToken() itself, since the same token doubles as the bearer
// credential for uploads/signaling for the rest of the M0 session — see
// pairingRoutes.ts. Evicted lazily on the token's own TTL so this can't grow
// without bound.
const consumedNonces = new Map<string, number>();

function evictExpiredNonces(now: number): void {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) consumedNonces.delete(nonce);
  }
}

function getSecret(): string {
  const secret = process.env.PAIRING_TOKEN_SECRET;
  if (!secret || secret.startsWith("replace-me")) {
    throw new Error(
      "PAIRING_TOKEN_SECRET is not set. Copy .env.example to .env and generate a real value with `openssl rand -hex 32`.",
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

// Session credentials are signed with a `session.` domain prefix so a valid
// session credential's signature can never be replayed as a valid pairing
// token (or vice versa) even though both use the same secret.
function signSession(payloadB64: string): string {
  return sign(`session.${payloadB64}`);
}

export function generatePairingToken(): string {
  const token: PairingToken = {
    nonce: randomBytes(16).toString("hex"),
    issuedAt: Date.now(),
  };
  const payload = JSON.stringify(token);
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyPairingToken(token: string): boolean {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return false;

  const expected = sign(payloadB64);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return false;

  // The signature check above already proves this payload was produced by
  // generatePairingToken() for any input we issued — but a byte-identical
  // signature isn't guaranteed for arbitrary attacker input, so decoding
  // still must not be allowed to throw and take the process down with it.
  try {
    const decoded: PairingToken = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString(),
    );
    return (
      typeof decoded.issuedAt === "number" &&
      Date.now() - decoded.issuedAt <= TOKEN_TTL_MS
    );
  } catch {
    return false;
  }
}

/**
 * Long-lived (30 day) credential issued once at pairing time. Unlike the
 * short-lived pairing token, this is what the client actually uses as its
 * bearer credential for uploads/signaling afterward — a 5-minute TTL was too
 * short to survive a fully offline recording session (see
 * docs/SECURITY.md "Offline recording"), so pairing no longer hands back the
 * pairing token itself as the credential.
 */
export function generateSessionCredential(): string {
  const credential: SessionCredential = {
    sessionNonce: randomBytes(16).toString("hex"),
    issuedAt: Date.now(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(credential)).toString("base64url");
  const signature = signSession(payloadB64);
  return `session.${payloadB64}.${signature}`;
}

export function verifySessionCredential(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "session") return false;
  const [, payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return false;

  const expected = signSession(payloadB64);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return false;

  try {
    const decoded: SessionCredential = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    return (
      typeof decoded.issuedAt === "number" && Date.now() - decoded.issuedAt <= SESSION_TTL_MS
    );
  } catch {
    return false;
  }
}

/**
 * Marks a token's nonce as used for the pairing handshake specifically.
 * Returns false if the token is invalid/expired, or if this exact nonce has
 * already completed pairing once. Call only from POST /api/pair.
 */
export function consumePairingNonce(token: string): boolean {
  if (!verifyPairingToken(token)) return false;

  const payloadB64 = token.split(".")[0] ?? "";
  const decoded: PairingToken = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString(),
  );

  const now = Date.now();
  evictExpiredNonces(now);

  if (consumedNonces.has(decoded.nonce)) return false;
  consumedNonces.set(decoded.nonce, decoded.issuedAt + TOKEN_TTL_MS);
  return true;
}
