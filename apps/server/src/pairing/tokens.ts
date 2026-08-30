import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * Short-lived, HMAC-signed pairing tokens. A device that presents a valid,
 * unexpired token is considered paired: this is the actual authorization
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
  // Only a credential stamped with the current epoch is valid. The epoch
  // changes only on an explicit revokeAllSessions(), so pairing a second
  // device does NOT evict the first: the iPad and the laptop mirror are both
  // expected to hold a live credential at the same time.
  generation: number;
}

// Nonces consumed by the /api/pair handshake, so a captured token can't be
// replayed to re-run pairing even inside its TTL. Not checked by
// verifyPairingToken() itself, since the same token doubles as the bearer
// credential for uploads/signaling for the rest of the M0 session: see
// pairingRoutes.ts. Evicted lazily on the token's own TTL so this can't grow
// without bound.
const consumedNonces = new Map<string, number>();

// inkboard is used with two devices at once: the iPad holds the pen and the
// laptop shows a read-only mirror, so both must be paired simultaneously.
// The previous model bumped a single counter on every mint and required an
// exact match, which meant pairing the laptop silently revoked the iPad.
//
// Instead, credentials are stamped with an epoch and tracked individually:
//  - `currentEpoch` changes only on an explicit revokeAllSessions(), so
//    "kick every device" is still one call.
//  - `activeSessions` holds the nonce of every live credential, capped, so a
//    forgotten device cannot accumulate credentials without bound and the
//    oldest is evicted first.
//  - Both are mirrored to disk by initSessionStore(), so a restart no longer
//    silently un-pairs every device. See the note on initSessionStore below.
// See docs/SECURITY.md.
let currentEpoch = Date.now();

// Where the session store is mirrored to disk. Null until initSessionStore()
// names a path, which keeps tests (and app.inject()) purely in-memory unless
// they opt in.
let sessionStorePath: string | null = null;

/**
 * Cap on simultaneously paired devices. Two is the real use case (iPad plus
 * laptop mirror); the headroom covers re-pairing a device without having to
 * explicitly revoke first.
 */
export const MAX_ACTIVE_SESSIONS = 4;

/** sessionNonce -> issuedAt, for every credential currently considered live. */
const activeSessions = new Map<string, number>();

interface PersistedSessions {
  epoch: number;
  sessions: Array<[string, number]>;
}

/**
 * Mirrors the session store to disk so pairing survives a server restart.
 *
 * Previously `currentEpoch` and `activeSessions` lived only in memory, so
 * every restart silently invalidated every credential and both devices had to
 * be re-paired from a QR code. That reduced the deliberate 30-day credential
 * TTL (SESSION_TTL_MS) to "until the next Ctrl+C", and it is the single
 * biggest reason starting a session took a dozen steps instead of one.
 *
 * The secret this is all keyed on (PAIRING_TOKEN_SECRET) already lives on
 * disk in .env, so persisting the far less sensitive nonce list alongside it
 * does not weaken the threat model. revokeAllSessions() remains the explicit
 * "kick every device" control.
 */
export function initSessionStore(filePath: string): void {
  sessionStorePath = filePath;
  if (!existsSync(filePath)) return;

  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as PersistedSessions).epoch !== "number" ||
      !Array.isArray((parsed as PersistedSessions).sessions)
    ) {
      return;
    }
    const data = parsed as PersistedSessions;
    currentEpoch = data.epoch;
    activeSessions.clear();
    const now = Date.now();
    for (const entry of data.sessions) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [nonce, issuedAt] = entry;
      if (typeof nonce !== "string" || typeof issuedAt !== "number") continue;
      // Do not resurrect a credential that expired while the server was down.
      if (now - issuedAt > SESSION_TTL_MS) continue;
      activeSessions.set(nonce, issuedAt);
    }
  } catch {
    // A corrupt store is non-fatal: it only means the devices re-pair once,
    // which is strictly better than refusing to boot.
  }
}

function persistSessions(): void {
  if (!sessionStorePath) return;
  const payload: PersistedSessions = {
    epoch: currentEpoch,
    sessions: [...activeSessions],
  };
  try {
    mkdirSync(dirname(sessionStorePath), { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated file
    // that would un-pair every device on the next boot. Same pattern as
    // BoardState.
    //
    // The temp name carries the pid so two processes sharing a RECORDINGS_DIR
    // cannot rename each other's half-written file into place. chmod is
    // explicit because writeFileSync's `mode` applies only when it creates the
    // file: a leftover world-readable temp file from an earlier run would
    // otherwise keep its permissions straight through the rename, publishing
    // the session nonce registry to every local user.
    const tmp = `${sessionStorePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, sessionStorePath);
  } catch {
    // Persistence is an optimization, never a reason to fail a pairing.
  }
}

/** Test seam: forget the on-disk mirror without touching live sessions. */
export function resetSessionStoreForTests(): void {
  sessionStorePath = null;
  activeSessions.clear();
  currentEpoch = Date.now();
}

function evictExpiredSessions(now: number): void {
  for (const [nonce, issuedAt] of activeSessions) {
    if (now - issuedAt > SESSION_TTL_MS) activeSessions.delete(nonce);
  }
}

/**
 * Invalidates every credential issued so far. The epoch bump means even a
 * credential whose nonce somehow survived stops verifying.
 */
export function revokeAllSessions(): void {
  activeSessions.clear();
  currentEpoch = Date.now() + 1;
  persistSessions();
}

/** Number of devices currently holding a valid credential. */
export function activeSessionCount(): number {
  evictExpiredSessions(Date.now());
  return activeSessions.size;
}

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
  // generatePairingToken() for any input we issued, but a byte-identical
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
 * bearer credential for uploads/signaling afterward: a 5-minute TTL was too
 * short to survive a fully offline recording session (see
 * docs/SECURITY.md "Offline recording"), so pairing no longer hands back the
 * pairing token itself as the credential.
 *
 * Each call mints an independent credential and records its nonce in
 * activeSessions, up to MAX_ACTIVE_SESSIONS. Minting does NOT revoke earlier
 * credentials: the iPad and the laptop mirror must both stay paired. Use
 * revokeAllSessions() to kick every device.
 */
export function generateSessionCredential(): string {
  const now = Date.now();
  evictExpiredSessions(now);

  // Evict the oldest rather than refusing to pair: being locked out of your
  // own board because of stale entries is a worse failure than dropping the
  // least recently paired device.
  while (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    let oldestNonce: string | undefined;
    let oldestAt = Infinity;
    for (const [nonce, issuedAt] of activeSessions) {
      if (issuedAt < oldestAt) {
        oldestAt = issuedAt;
        oldestNonce = nonce;
      }
    }
    if (!oldestNonce) break;
    activeSessions.delete(oldestNonce);
  }

  const sessionNonce = randomBytes(16).toString("hex");
  activeSessions.set(sessionNonce, now);
  persistSessions();

  const credential: SessionCredential = {
    sessionNonce,
    issuedAt: now,
    generation: currentEpoch,
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
      typeof decoded.issuedAt === "number" &&
      typeof decoded.generation === "number" &&
      typeof decoded.sessionNonce === "string" &&
      Date.now() - decoded.issuedAt <= SESSION_TTL_MS &&
      decoded.generation === currentEpoch &&
      activeSessions.has(decoded.sessionNonce)
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
