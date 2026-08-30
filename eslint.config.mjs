import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.husky/**",
      "infra/caddy/data/**",
      // Nested git worktrees live under .claude/worktrees/ and contain a full
      // second copy of the repo. Linting them double-reports every file and,
      // worse, their scripts/ dir no longer matches the "scripts/**/*.mjs"
      // override below, so Node globals resolve as no-undef errors and the
      // lint gate fails on a tree whose committed sources are clean.
      "**/.claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // scripts/ are standalone Node programs run against a live server, not
    // part of either app's bundle, so they use Node globals directly.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
      },
    },
  },
);
