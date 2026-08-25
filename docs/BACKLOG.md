# Scaling & hardening backlog

[ROADMAP.md](./ROADMAP.md) is the sequential build plan (M0 → M5). This doc is the
cross-cutting list of improvements layered on top of it — things worth doing to make
inkboard faster, safer, more useful, and nicer to use, roughly ordered by impact vs. effort.
Kevin picks what to build next; nothing here is committed to a milestone.

Grounded in the actual current state (not aspirational):
- The client bundle is 1.95MB (599KB gzipped) — Vite's own build output flags this.
- No automated tests exist anywhere. Every bug found so far (the upload route's 415 on real
  video blobs, a malformed-but-signed pairing token crashing request handling, two CI
  misconfigurations) was caught by hand during manual stress-testing, not by anything that
  runs automatically on the next change.
- The UI is bare default tldraw. The original spec described a purpose-built, boring
  toolbar with a pre-flight checklist (Pencil ready / camera detected / mic level / disk
  space / server connected) gating "REC" — never built.
- The security baseline covers secrets/transport/pairing but has no rate limiting, no
  security headers, and pairing tokens are reusable within their 5-minute TTL (not
  single-use).

## Now — high impact, low-to-medium effort

**Testing** (the biggest gap — every bug found this session was manual)
- Add Vitest to `packages/shared-schema` and `apps/server`: unit tests for
  `verifyPairingToken`/`generatePairingToken` (valid, expired, tampered, malformed-payload —
  literally the bugs found by hand this session) and for the upload route's session-id/
  path-traversal guard. Wire into `ci.yml`.

**Security**
- [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) on `/api/pair` —
  nothing currently stops brute-force guessing against the pairing endpoint.
- [`@fastify/helmet`](https://github.com/fastify/fastify-helmet) for baseline security
  headers (CSP, no-sniff, etc.) on the served PWA.
- Make pairing tokens single-use: track consumed nonces in a small in-memory Set with TTL
  eviction, so a token can't be replayed even inside its 5-minute window.

**Performance**
- Fix the 1.95MB bundle: `manualChunks` in `apps/client/vite.config.ts` to split `tldraw`
  and `katex` into their own vendor chunks, and lazy-load KaTeX inside `MathShapeUtil` (only
  paid for when a Math object actually exists on the board).
- Defer loading the tldraw editor bundle until *after* the pairing gate passes — right now
  the whole editor ships to an unpaired device before it's even allowed in.

**UI/UX**
- Build the originally-envisioned purpose-built toolbar in place of bare default tldraw UI:
  Pen / Eraser / Undo / Redo / Page / **REC**, plus the pre-flight checklist (✓ Pencil ready,
  ✓ Camera detected, ✓ Mic level moving, ✓ Server connected, ✓ Disk space) that disables REC
  until everything is green. This is the single biggest polish gap between "PoC" and
  "something pleasant to actually use."

## Next — real value, medium effort (natural follow-ons to M1/M2)

**Use cases**
- Board export to PDF/PNG per page (tldraw ships export utilities) — useful for "share my
  notes" without waiting on the full video pipeline.
- "Quick capture" mode: ink-only, no facecam, single page — a fast note-taking use case
  distinct from full teaching-video recording, reusing the same board engine.
- SRT/VTT caption export once the whisper transcript (M2) exists.

**Security**
- Make `dependency-audit.yml` blocking once a clean baseline is confirmed (currently
  non-blocking by design).
- A short runbook for rotating Caddy's local CA (expiry, re-trust-on-iPad steps).
- A minimal local audit log of pairing events (when/which device paired) — cheap personal
  forensics if a device is ever lost, no infra required.

**UI/UX**
- Connection-status indicator with auto-reconnect for the WS signaling client.
- A simple session/recording browser (list past recordings on the XPS from the PWA).

**Performance**
- Evaluate WebCodecs (`VideoEncoder`/`AudioEncoder` — fully supported on iPadOS Safari 26)
  as a local-encode alternative to `MediaRecorder` once M1's live capture lands, for more
  control over quality/bitrate than the browser's default WebM encoder.

## Later — bigger swings, worth real design time

**Use cases**
- Full-text search over past sessions' semantic TEXT/MATH content — since the board is
  structured data, not video, this is comparatively easy and a genuine differentiator vs. a
  plain screen recording: effectively a searchable personal knowledge base for free.
- Extend M4 (AI-agent API): an agent that consumes a finished session's journal + transcript
  to auto-generate a study summary or quiz — a concrete "AI co-teacher" beyond just letting
  an agent draw.
- M3's translation milestone as a real "publish in N languages from one recording" utility,
  not just an architectural capability.

**Performance**
- Tiled/virtualized canvas rendering — deferred: tldraw already handles reasonably large
  boards, and this is premature optimization until a real session demonstrates lag at scale.

**Security**
- Revisit the auth model only if/when inkboard stops being single-operator — not before.
