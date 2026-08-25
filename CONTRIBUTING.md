# Contributing

This is currently a personal, single-maintainer project. Issues and PRs are
welcome once the repo is public, but there's no formal process yet.

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

## Before committing

A pre-commit hook (husky + gitleaks) runs automatically and blocks commits
that look like they contain a secret. Don't bypass it with `--no-verify`.

## Conventions

- TypeScript everywhere in `apps/` and `packages/`; the Python
  `services/whisper-sidecar` is the one intentional exception (see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why it's a separate
  sidecar process rather than part of the JS workspace).
- Keep `packages/shared-schema` the single source of truth for board object
  and journal event shapes — don't redefine them locally in the client or
  server.
- Commit messages: short, imperative, no AI/automation attribution.
