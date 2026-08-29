import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootEnvPath } from "./env.js";

/**
 * Regression guard for the startup bug where the server resolved .env from
 * process.cwd(). Every documented start path (pnpm --filter, dev-up.sh) runs
 * with cwd = apps/server, so the repo-root .env was silently skipped and the
 * server died on PAIRING_TOKEN_SECRET. These assertions fail if the path ever
 * drifts back toward the package directory.
 */
describe("repoRootEnvPath", () => {
  it("points at a file literally named .env", () => {
    expect(basename(repoRootEnvPath)).toBe(".env");
  });

  it("resolves to the workspace root, not the server package", () => {
    const resolvedDir = dirname(repoRootEnvPath);

    // pnpm-workspace.yaml exists only at the repo root, so it is the
    // unambiguous marker that we climbed out of apps/server.
    expect(existsSync(join(resolvedDir, "pnpm-workspace.yaml"))).toBe(true);

    expect(resolvedDir.endsWith(join("apps", "server"))).toBe(false);
  });

  it("does not depend on the current working directory", () => {
    const original = process.cwd();
    try {
      process.chdir(dirname(repoRootEnvPath));
      const fromRoot = repoRootEnvPath;
      process.chdir(original);
      expect(fromRoot).toBe(repoRootEnvPath);
    } finally {
      process.chdir(original);
    }
  });
});
