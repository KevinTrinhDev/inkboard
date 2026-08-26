# Scaling & hardening backlog

[ROADMAP.md](./ROADMAP.md) is the sequential build plan (M0 → M5). This doc is the
cross-cutting list of improvements layered on top of it — things worth doing to make
inkboard faster, safer, more useful, and nicer to use, roughly ordered by impact vs. effort.
Kevin picks what to build next; nothing here is committed to a milestone.

Grounded in the actual current state:
- **Done, this pass:** all five "Now" items below — tests, rate limiting, helmet, single-use
  pairing tokens, bundle splitting, deferred tldraw load, and the real toolbar/checklist.
  Verified live: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, plus a
  running-server smoke test (helmet headers present, single-use token confirmed via a real
  double-pair attempt, rate limit confirmed by tripping 429 at the 5th `/api/pair` call).
- Remaining gaps: real M1 WebRTC capture doesn't exist yet, so the checklist's "server
  connected" only proves the signaling WS is reachable, not that live capture works. The
  toolbar's page-cycling and REC gating haven't been used on real iPad hardware yet — see
  "Verify on hardware" below.

## Now — done this pass (offline + encryption round)

**Offline-first recording** ✅ — recording no longer depends on network
reachability at all. `readyToRecord` now gates only on pencil/camera/mic/
disk; `serverConnected` is informational in the checklist. A finished take
is encrypted on-device and written to IndexedDB before any network attempt,
then a background sync loop (retry every 15s + on the `online` event)
uploads it whenever the XPS is actually reachable. The toolbar shows a
"N waiting to sync" count. See [SECURITY.md](./SECURITY.md) "Offline
recording".

**Client-side encryption at rest** ✅ — recordings are AES-256-GCM encrypted
in the browser with a key generated on-device (Web Crypto) and stored only
in that device's IndexedDB; the key is never sent over the network in any
form. The server stores exactly the ciphertext it receives (`.webm.enc`)
and cannot decrypt it. See [SECURITY.md](./SECURITY.md) "Encryption at
rest" for the explicit trade-off (no key recovery/export exists yet).

**Long-lived session credential** ✅ — fixes a real bug: uploads previously
authenticated with the 5-minute pairing token itself, so any recording that
took longer than 5 minutes to sync (which offline recording now makes
common) would 401 on upload. Pairing now issues a separate, domain-
separated 30-day session credential instead.

## Now — done previous pass

**Testing** ✅ — `apps/server` has Vitest (`pnpm test`, wired into `ci.yml`): unit tests for
`verifyPairingToken`/`generatePairingToken`/`consumePairingNonce` (valid, expired, tampered,
malformed-payload, single-use replay — the exact bugs found by hand last session) and for the
upload route's auth/session-id/path-traversal guard (via Fastify's `.inject()`, no real
server needed). 15 tests, all passing.

**Security** ✅
- `@fastify/rate-limit`: 5/min on `/api/pair` (confirmed live — 429 after 5 calls), 200/min
  global default elsewhere.
- `@fastify/helmet`: CSP + standard hardening headers on every response (confirmed live).
- Pairing tokens are now single-use for the *handshake* specifically (`consumePairingNonce`,
  an in-memory nonce set with TTL eviction) — a captured token can't re-run `/api/pair`. The
  same token still works as the bearer credential for uploads/signaling afterward, since it
  doubles as the M0 session credential (confirmed live: pair once, second pair attempt 401s,
  upload with the same token still 200s).

**Performance** ✅ — `manualChunks` splits `tldraw` (1.68MB) and `katex` (261KB) into their
own vendor chunks; KaTeX is dynamic-`import()`ed inside `MathShapeUtil` (only loaded once a
Math object renders); `BoardCanvas` (and therefore all of tldraw) is `React.lazy`-loaded
inside `<PairingGate>`, so an unpaired device's initial JS is ~7KB instead of the full
bundle. Confirmed via `pnpm build` chunk output.

**UI/UX** ✅ — `AppToolbar.tsx` replaces default tldraw chrome (`MainMenu`/`StylePanel`/
`PageMenu` hidden) with Pen/Eraser/Text/Math/Arrow/Shape/Undo/Redo/Page/**REC**, plus the
literal pre-flight checklist from the original spec (✓ Pencil ready — first `pointerType:
"pen"` event seen, ✓ Camera detected, ✓ Mic level moving — RMS-over-threshold via
AnalyserNode, ✓ Server connected — signaling WS handshake, ✓ Disk space —
`navigator.storage.estimate()`), all five gating REC. `useRecordingRig` owns the single
`getUserMedia` call (previously acquired independently by `CameraPreview`, a latent bug that
would have caused duplicate permission prompts).

**Not yet done — verify on hardware**: none of this pass's UI/preflight logic has run on a
real iPad + Apple Pencil yet, only in this dev environment. Pencil detection in particular
(`pointerType === "pen"`) needs confirming against real Safari/iPadOS behavior before relying
on it.

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
