import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, HMAC-signed pairing tokens. A device that presents a valid,
 * unexpired token is considered paired — this is the actual authorization
 * gate, not "is on the same Wi-Fi." See docs/SECURITY.md.
 */

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes to scan the QR

export interface PairingToken {
  nonce: string;
  issuedAt: number;
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

  const decoded: PairingToken = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString(),
  );
  return Date.now() - decoded.issuedAt <= TOKEN_TTL_MS;
}
