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

## Now — done this pass (hardware verification + hardening round)

**Real hardware findings** — first actual iPad + Apple Pencil test run surfaced two real
bugs, both fixed and confirmed live:
- **Pencil drew like a mouse (no ink, camera panned/zoomed instead).** Root cause: the page
  never told Safari to hand touch/pointer gestures to the canvas — without `touch-action:
  none` + `overscroll-behavior: none` on `html`/`body`/`#root`, Safari intercepts a
  one-finger drag as native scroll/pinch-zoom before tldraw's own pointer handling ever sees
  it. Fixed in `apps/client/index.html`.
- **`inkboard.local` never resolved at all.** Avahi publishes the machine's actual hostname
  (`<hostname>.local`), not an arbitrary alias — nothing had configured `inkboard.local` as
  an mDNS alias, so every attempt just hung. Worked around by pointing `CADDY_DOMAIN` at the
  LAN IP directly instead (`192.168.1.88`), which needs no name resolution at all. A real
  fix (an `/etc/avahi/hosts` alias, or a router DHCP reservation + proper mDNS config) is
  still open — see "Next" below.

**Security fixes found during a real audit pass** — all confirmed live via `ss -tlnp` and
`curl` before/after:
- **Fastify was bound to `0.0.0.0:8080`** — directly reachable on the LAN over plain HTTP,
  completely bypassing Caddy's TLS termination. Fixed to `127.0.0.1` only; confirmed the
  direct port now refuses connections from the LAN while `https://<ip>/healthz` through
  Caddy still returns 200.
- **Upload route left corrupt partial files on a failed/interrupted transfer** (disk full,
  connection drop) with no cleanup, and could leak raw error details in the response. Now
  cleans up the partial file and returns a generic error; also added an explicit byte-count
  cap as defense in depth alongside Caddy's own `request_body` limit, since this route can be
  hit directly during local dev without going through Caddy at all.
- **CSP allowed plain `ws:`** even though the app is always served over HTTPS/`wss:` via
  Caddy — tightened to `wss:` only.

**UI pass**: toolbar rebuilt as icon-only buttons (hand-authored inline SVG, no new
dependency) instead of text labels — tooltips carry the label text for accessibility. The
pre-flight checklist switched from text checkmarks to compact colored-dot indicators.
Verified via `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (24/24 tests).

**Explicitly out of scope for this pass, and why:**
- Removing the tldraw watermark — tldraw requires either a free community license key
  (available at tldraw.dev for qualifying use) or a paid commercial one; hiding it without
  either would violate their license terms. Get a key and it's a one-line wire-up.
- Router/Wi-Fi hardening (WPA3, guest network isolation, firmware updates) and iPad-side
  settings (passcode, auto-lock, iOS updates) — both require direct access to the router
  admin panel and the physical device's Settings app, neither of which this tooling can
  reach or configure.
- A "production" deployment — this project is LAN-only by design (see SECURITY.md); there is
  no cloud target to deploy to. The XPS it already runs on *is* the deployment target.

**Not yet fixed — a real known gap**: a recording's ink/video only reaches durable storage
(IndexedDB, then upload) once `stop()` completes; if the browser tab crashes or the app is
force-closed mid-recording, everything captured since the last `start()` is lost — nothing is
persisted incrementally during an in-progress take. Fixing this properly means writing
`MediaRecorder` chunks to IndexedDB as they arrive rather than buffering them in memory until
stop, which is a real design change, not a quick patch — tracked here rather than rushed.

## Previous pass (offline + encryption round)

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
