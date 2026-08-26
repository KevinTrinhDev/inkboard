# Contributing

This is currently a personal, single-maintainer project. Issues and PRs are
welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before
participating.

Known gaps (real iPad hardware verification, live WebRTC capture, etc.) are
tracked in [docs/BACKLOG.md](docs/BACKLOG.md) and
[docs/ROADMAP.md](docs/ROADMAP.md): check there before opening an issue for
something already planned.

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
  and journal event shapes: don't redefine them locally in the client or
  server.
- Commit messages: short, imperative, no AI/automation attribution.
