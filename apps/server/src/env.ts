import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/**
 * Loads the repo-root .env, and must be imported before any module that
 * reads process.env.
 *
 * `import "dotenv/config"` resolves .env relative to process.cwd(). Every
 * documented way of starting this server sets cwd to the package directory
 * rather than the repo root: `pnpm --filter @inkboard/server dev`, the same
 * with `start`, and infra/scripts/dev-up.sh, which cds to the repo root,
 * asserts .env exists there, and then shells out to `pnpm --filter` anyway.
 * So cwd was apps/server, the root .env was never read, and the server threw
 * "PAIRING_TOKEN_SECRET is not set" despite a correctly filled-in .env.
 *
 * Resolving from this module's own URL instead is stable under both
 * `tsx src/index.ts` and `node dist/index.js`, since src/ and dist/ sit at
 * the same depth under apps/server.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo-root .env. Exported so env.test.ts can assert it. */
export const repoRootEnvPath = join(here, "..", "..", "..", ".env");

// dotenv does not overwrite variables that are already set, so a real
// environment variable (systemd, CI, a shell export) still wins over the file.
config({ path: repoRootEnvPath });
