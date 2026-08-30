import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every on-disk location the server writes to, resolved once, from this
 * module's own URL rather than process.cwd().
 *
 * Two bugs motivated centralizing this:
 *
 *  - app.ts defaulted RECORDINGS_DIR to "./apps/server/recordings" while
 *    uploadRoute.ts defaulted the same variable to "./recordings". Both were
 *    relative to cwd, which is apps/server under every documented start
 *    command, so board state and recordings landed in two different trees
 *    (apps/server/apps/server/recordings and apps/server/recordings).
 *  - A relative RECORDINGS_DIR in .env therefore meant something different
 *    depending on which module read it, and `.env.example` shipped exactly
 *    such a value.
 *
 * Anchoring to the repo root makes a relative RECORDINGS_DIR mean the same
 * thing everywhere and behave identically under `tsx src/index.ts` and
 * `node dist/index.js`, since src/ and dist/ sit at the same depth.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root. */
export const repoRoot = resolve(here, "..", "..", "..");

/**
 * Where recordings, board state, assets and the session store live.
 * A relative RECORDINGS_DIR is resolved against the repo root, not cwd.
 */
export function resolveRecordingsDir(): string {
  const configured = process.env.RECORDINGS_DIR ?? "apps/server/recordings";
  return isAbsolute(configured) ? configured : resolve(repoRoot, configured);
}

/**
 * Where paired-device credentials are mirrored so pairing survives a restart.
 * Kept beside the board state: same lifetime, same "delete this to start
 * clean" story.
 */
export function defaultSessionStorePath(recordingsDir: string): string {
  return join(recordingsDir, "sessions.json");
}
