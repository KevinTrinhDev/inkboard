# Implementation plan — inkboard (2026-09)

Task-level companion to [ROADMAP.md](./ROADMAP.md) (what ships, in order) and
[REVIEW.md](./REVIEW.md) (why — findings with sources). Each item lists the
files to touch, the acceptance criteria, and a size estimate (S ≤ 1 day, M ≤
3 days, L ≤ 1 week for one person; adjust to reality). Items are ordered
within a phase. Keep the gate green at every step:

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## Phase 0 — Merge & first real take

### 0.1 — Integrate `polish-and-onboarding` into the trunk  ✅ done
[M] **Done 2026-09:** `main` fast-forwarded through `final-hardening-pass`
(`7290298`) to `polish-and-onboarding` (`928f4f7`) and pushed. Verify in CI
(see 0.5) and on this machine; prune the superseded local branches/worktrees
(`final-hardening-pass`, `hardware-fixes-and-hardening` where superseded).

### 0.2 — Confirm the red local lint is gone (`eslint .` vs `.claude/worktrees/`)
[S] Already fixed upstream — `eslint.config.mjs` ignores `**/.claude/**`.
Verify: bare `pnpm lint` exits 0 on this machine with the worktrees present.

### 0.3 — Docs that lie are rewired to the merged behaviour
[M] Update: README record/pairing/quickstart wording; `docs/SECURITY.md`
session-restart semantics + per-device tokens (`--pair` to reset);
`docs/BACKLOG.md` status header → point at REVIEW/ROADMAP as the living
plans and keep only the idea vault. AC: no doc asserts a capability the code
lacks (spot-check each P0 claim in REVIEW.md).

### 0.4 — First real end-to-end take on hardware
[M] On the XPS + iPad: two QR pairings, live mirror, record → encrypted
upload → `.webm.enc` on server; restart server → devices reconnect paired;
sleep/reconnect the iPad mid-session and confirm board continuity. Log
anything that fails as a new finding in REVIEW.md. AC: the Phase 0 "Done
when" list from ROADMAP holds.

### 0.5 — CI on the actual trunk
[S] `ci.yml` triggers on `push: [main]` — rename/point to the real trunk and
run the dependency-audit job's reports through a first triage. AC: a push to
trunk runs typecheck/lint/test/build; statuses are meaningful again.

---

## Phase 1 — One complete lesson on one board

### 1.1 — Pen ownership, made robust (REVIEW P1-1)
[M] Server: when an `editor` hello arrives and another live editor exists,
kick the old one **only if the new one proves it is the same device**, or
demote instead of kicking when it is a genuinely different credential;
return a distinct error code (e.g. `editor-contended`). Client: on that code,
stop reconnecting as editor, show "Another device has the pen" and offer a
"Take over" action, instead of the current silent reconnect loop.
Files: `apps/server/src/ws/boardSync.ts`, `packages/shared-schema/src/sync/protocol.ts`
(new error code), `apps/client/src/board/useBoardSync.ts`,
`apps/client/src/board/SyncStatusPill.tsx`.
AC: unit test — two live editors settle to one without flapping; client
integration shows the takeover UI; kicked-stale-editor reconnect still
works (existing tests stay green).

### 1.2 — iPad board survives being offline and killed (REVIEW P1-2)
[M] Choose (decision in 1.2a below), then: on the `editor`, persist the
board locally as you draw (tldraw `persistenceKey` or an explicit
snapshot-to-IndexedDB cadence) and reconcile on reconnect: server snapshot
wins for records it has; local unsent edits are replayed on top (the
`carried`-pending logic in `useBoardSync.ts` already does the replay part).
Mirror keeps no local board.
1.2a [S] Spike: `persistenceKey` vs. manual snapshot — check schema
migration behaviour and conflicts with the server store; write the choice in
a code comment + this doc.
Files: `apps/client/src/board/BoardCanvas.tsx`, `useBoardSync.ts`, new
`board/persist.ts`.
AC: draw with the server stopped, kill the iPad tab, reopen → board
reappears; when the server returns, the board converges (server state +
replayed local edits), nothing duplicates.

### 1.3 — Real text entry (REVIEW P2-1)
[M] Decision first (D-Text): adopt **tldraw's built-in `text` shape**
(`TLTextShape`: double-tap editing, auto-size, TipTap rich text — free,
well-tested, works headless) and map rich text → plain `content` for the
semantic TEXT object; or keep the custom `TextShapeUtil` and build a light
DOM overlay editor so `props.content` stays a plain string. Both sync fine;
the trade is editing-for-free + a richText→plain mapping vs. a fully
controlled plain-string model. Do a short spike on the iPad (IME behaviour,
multi-line, undo), then implement the chosen path.
1.3a [S] spike on the iPad: native-text editing quality + mapping cost.
Files: `apps/client/src/board/shapes/TextShapeUtil.tsx` (or removal +
`text` tool wiring in `BoardCanvas.tsx`/`AppToolbar.tsx`).
AC: on the iPad, a teacher can type a sentence into a TEXT shape, undo works,
empty content deletes the shape, and the stored semantic content is a plain
string that reaches the typed export (Phase 2).

### 1.4 — Real math entry (REVIEW P2-1)
[M] Tap on a MATH shape (or the Math tool) opens a small LaTeX entry with
live KaTeX preview; commit stores clean LaTeX; invalid LaTeX is surfaced,
not silently dropped (`throwOnError:false` stays for render).
Files: `MathShapeUtil.tsx`, a shared `latex-input` overlay, reuse KaTeX chunk.
AC: type `F = ma`/`\frac{a}{b}` → preview updates live → commit → mirror
shows identical render; board record stores the latex string.

### 1.5 — Dictation-first text (REVIEW P2-1, roadmap P4 start)
[M] Ship the Phase-4 voice path's *fast cut* now as the primary way to put a
sentence on the board: hold the text tool / a mic affordance, speak, text
inserts at the tapped point (see Phase 4 for engine choice; keep the
interface behind `useDictation` so the engine can swap). If this lands before
the whisper sidecar, gate it behind a "voice available" probe.
Files: new `apps/client/src/board/useDictation.ts`, server route
`POST /api/dictate` (Phase 4 files).
AC: on the LAN with the engine warm, tap → speak one sentence → editable TEXT
appears; a missing engine shows a clear "voice not configured" state.

### 1.6 — Real arrow and shape tools (REVIEW P2-1)
[M] Arrow: two-point creation with arrowhead, stored as points (matches
`ArrowObject`). Shape: rect/ellipse/line with hand-drawn look — decision:
sketchy rendering via hand-rolled rough SVG paths in `ShapeUtil.toSvg` vs.
tldraw native geo styling (rough.js itself is effectively unmaintained and
has no tldraw 3 wrapper — REVIEW §5). Replace the toolbar stubs
(`ArrowShapeUtil`, `RoughShapeUtil`, `createShapeTool`) with real
interactions. Files: `apps/client/src/board/shapes/*.tsx`, `board/tools/*`,
`board/AppToolbar.tsx` (add shape-kind submenu or cycling).
AC: an arrow with a head and a rough rectangle/ellipse/line can be drawn,
resized, synced to the mirror, and exported.

### 1.7 — Style basics
[M] Color + stroke width per shape (schema already carries `color` on
INK/ARROW/SHAPE; add to TEXT/MATH if wanted). Small style popover in the
toolbar with 4–6 board colors + 2–3 widths. Files: schema defaults,
`AppToolbar.tsx`, shape props.
AC: styles round-trip through the wire (opaque records) and appear in the
typed export (Phase 2).

### 1.8 — Usable pages (REVIEW P2-4)
[M] Previous/next page buttons, rename, delete-empty-page, and a compact page
indicator ("3 / 4"). Files: `AppToolbar.tsx`, small page model helper.
AC: a multi-page lesson can move both directions and pages are named; page
id round-trips through sync (tldraw pages already sync as records).

### 1.9 — Export a page / whole board (REVIEW §5)
[M] PNG export of the current page (tldraw `toImage`), and PDF assembled
client-side with pdf-lib from per-page images (browser-only export is the
SDK norm — REVIEW §5). Export lives on the laptop (mirror) where a desktop
browser can save files, and/or iPad via share sheet.
Files: new `apps/client/src/board/export.ts`, toolbar button.
AC: export a drawn board to a PNG and a multi-page PDF whose pages match the
board pages.

### 1.10 — Durable recording: timeslices → IndexedDB (REVIEW P1-3)
[L] MediaRecorder `timeslice` (already 5 s on polish) chunks are appended to
a per-take IndexedDB store as they arrive, then `stop()` composes the
encrypted blob from stored chunks (streaming encryption by chunk group,
AES-GCM per chunk with a take-level IV chain — do **not** buffer the whole
take). Crash/close mid-take then loses ≤ one chunk; unfinished takes are
listed as "interrupted" on next launch with a Resume/Discard choice. Files:
`apps/client/src/av/MediaRecorderCapture.ts`, new `recording/chunkStore.ts`,
`crypto/recordingKey.ts` (chunk encrypt API), `useRecordingRig.ts`.
AC: kill the tab mid-take → on relaunch the interrupted take is recoverable;
a 10-min take's peak memory stays flat (measure), and the uploaded file
decrypts to the same duration ± one chunk.

### 1.11 — Capture UX polish
[M] From the polish baseline: camera Retry (done there), a visible mic-level
bar near REC, and surface `MediaRecorder` `onerror` in the UI with a
"save what we have" path. Fix the iPad stray preview box if it survived
merging polish (`App.tsx` gates preview on `capture`). Files:
`RecordingControls.tsx`, `useRecordingRig.ts`, `App.tsx`.
AC: permission-denied camera shows an actionable error + Retry; encoder
failure is visible and does not masquerade as success.

### 1.12 — Wake Lock for lectures (REVIEW §5.2)
[S] Adopt: Wake Lock works for Home-Screen PWAs from iPadOS/iOS 18.4 (WebKit
bug 254545 fixed), which is already the floor (D8). Acquire the lock from a
user gesture when a recording/lesson starts while the editor tab is visible;
release on stop/visibility-hidden; re-acquire on visibilitychange. Files:
`useRecordingRig.ts` or a small `useWakeLock` hook.
AC: with the lock held, the iPad does not auto-lock mid-lesson (hardware
check); the lock releases when recording stops or the app backgrounds.

### 1.13 — Client tests + first browser e2e (REVIEW P5-3)
[M] Add Vitest to `apps/client` for pure logic (chunk store, crypto
round-trip, sync URL/backoff helpers, squashing already covered in schema).
Add Playwright: build + boot the real server, drive pair (inject a minted
token via server test hook or CLI), editor window + mirror window, draw a
shape via the app's own pointer events, assert it appears on the mirror,
record → assert upload. Files: `apps/client/package.json`, `apps/client/src/**/*.test.ts`,
new `e2e/` with a Playwright config and CI job.
AC: `pnpm test` includes client unit tests; `pnpm e2e` passes in CI against
the real server.

### 1.14 — tldraw majors spike + decision gate (REVIEW §5)
[M] Short spike: tldraw 3.15 → current (4/5) — API deltas for
`BaseBoxShapeUtil`/`StateNode`/`store.listen`/assets, React 19 requirement,
licensing effect (REVIEW §5: SDK is source-available; production use may
need a license key — record the decision: hobby/commercial/alternative
canvas). Outcome recorded in REVIEW §5 and this doc; default is "finish P1
on 3.x, upgrade in Phase 2 with the dependency wave".
AC: a written decision with a working upgrade proof or an explicit deferral.

**Phase 1 done when** = ROADMAP Phase 1 list, verified on hardware.

---

## Phase 2 — Sessions and the semantic layer

*(Detail level: enough to schedule; open files land once Phase 1 closes.)*

### 2.1 — Multi-session model
[L] Server: sessions table (id, name, createdAt, board store ref, asset
prefix), `POST /api/sessions`, `GET /api/sessions`, `POST …/close` (archive).
Board state and assets move under `RECORDINGS_DIR/<sessionId>/` (fix the
dual-path bug class once and for all via one `paths.ts`-style resolver — the
polish branch already centralizes paths; extend it). The client gets a
session picker ("New lesson", "Resume last"). AC: two lessons live as two
independent boards/recordings; restart keeps both.

### 2.2 — Journal + typed object export (the differentiator)
[L] Map tldraw records → normalized `BoardObject`s on write (TEXT/MATH from
shape props, INK from draw points with normalized coordinates, ARROW/SHAPE
from their geometry); persist CREATE/UPDATE/DELETE journal events with
monotonic `opId` per session (schema exists in `shared-schema`); implement
`GET /api/sessions/:id/journal?fromOp=N` and the client resync path
(API.md design target), replacing full-board welcomes for resync. AC: after
a lesson, the session JSON contains the typed objects the teacher made; a
reconnecting device resyncs deltas, not the whole board; `/api/schema`
matches the exported shapes.

### 2.3 — Storage bounds
[M] Asset GC per session (delete assets unreferenced by the session board,
on archive), board record cap with oldest-page eviction policy, storage
readout in the UI. AC: delete a session → its assets are removed; a
long-lived board stops growing without bound.

### 2.4 — Recording session index + iPad browser/playback
[L] Server: per-take metadata (duration, size, container from the encrypted
payload's headers block, session id). iPad: list its own past sessions,
fetch ciphertext, decrypt (fix REVIEW P1-4: store/read the true container
type in a small plaintext header before the IV), play locally. Add the key
backup/export flow (REVIEW P4-4) with an explicit warning UI.
AC: on the iPad, an old lesson plays back; a wiped browser prompts for the
backed-up key; the laptop never gains decryption ability.

### 2.5 — Hardening batch
[M] Pairing audit log (append-only local file: when, which device, outcome);
unify upload auth to `Authorization: Bearer` (REVIEW P4-5); return frozen
copies from `BoardState.snapshot()` (REVIEW P3-3); decide (and if wanted,
implement) expiring asset URLs (REVIEW P4-1); drop or fix the stale
`tokens.ts` comments (REVIEW P5-5). AC: covered by tests where behaviour
changed.

### 2.6 — Dependency modernization wave
[L] Staged: (1) toolchain that does not touch runtime behaviour first
(eslint 10, vitest 5, tsx, dotenv, @fastify/*); (2) zod 3→4 (shared-schema
rewrite of schemas + generated JSON schema); (3) Vite 6→8 + plugin chain;
(4) React 18→19 (check tldraw peer support first — see 1.14); (5) tldraw
majors last, alone. Gate green after every stage; record each stage's
changelog deltas. AC: full wave merged with `pnpm typecheck && pnpm lint &&
pnpm test && pnpm build` green and a hardware smoke of record/mirror.

### 2.7 — Search spike
[M] Index session journal TEXT/MATH content (sqlite? ripgrep over JSON?
in-memory per session) and expose `GET /api/search?q=` behind pairing;
minimal client results list. AC: search finds a phrase from a prior lesson in
< 1 s on the LAN.

**Phase 2 done when** = ROADMAP Phase 2 list.

---

## Phase 3 — Live pipeline / renderable timeline (legacy M1)

1. **Transport decision spike** [M]: MediaRecorder-on-laptop with wall-clock
   markers (cheapest, uses P1.10 durability) vs. WebRTC P2P vs. WebCodecs
   local encode. Input: REVIEW §5 iPadOS/browser facts. Default: keep
   MediaRecorder + timeline markers for v1 of the renderer.
2. **Timeline capture** [L]: during a take, log journal events with
   monotonic session time; record camera/mic segments keyed to the same
   clock (started/stopped timestamps).
3. **Renderer** [L]: offline pass that composites vector board + facecam into
   an MP4 master (browser canvas + MediaRecorder on the laptop, or ffmpeg on
   the server for the non-interactive case), ink appearing in sync.
   AC (Phase 3 done when, ROADMAP): a stored session re-renders to MP4 from
   recorded data alone.

## Phase 4 — Voice at teaching speed (legacy M2)

1. **Engine** [M]: wire faster-whisper sidecar (v1.2.x; keep `ctranslate2`
   pinned for the CUDA/cuDNN toolchain — REVIEW §5) or the maintained
   speaches HTTP wrapper (OpenAI-compatible, SSE); serve short-phrase dictation
   with base/small for latency and large-v3 int8 for batch transcription.
   Client: replace the `POST /api/dictate` stub in
   `apps/server/src/whisper/client.ts`.
2. **Dictation UX** [M]: complete the P1.5 fast-cut — insert-into-open-text,
   correction UI (show the transcript before commit when not live), pending
   state.
3. **Captions** [S]: SRT/VTT writer from faster-whisper word/segment
   timestamps (stable-ts is archived — do not adopt; WhisperX only if
   speaker diarization is later required).
   AC (Phase 4 done when, ROADMAP): tap → speak → text ≈ ≤1 s after phrase
   end on the LAN.

## Phase 5 — Handwriting, localization, publishing (legacy M3 + M5)

1. **Playpen Sans** [M]: self-host woff2 subsets (unicode-range splits per
   REVIEW §5 guidance); deterministic per-object seed
   (`hash(sessionId+objectId)`); TEXT renders in the font; optional
   irregularity layer; keep MATH in KaTeX. AC: two renders of the same
   session look identical; letters are legible at 24 px+.
2. **Localization pipeline** [L]: board + transcript → translated TEXT/MATH
   objects at the same normalized positions; per-language render + audio dub
   path (out of scope of UI until M3 fully lands; implement the data
   transforms first). AC (ROADMAP Phase 5): one recording yields a second
   language's video.

## Phase 6 — Agent API (legacy M4)

1. Objects/journal endpoints from 2.2 exposed with agent auth (separate
   credential class, rate limits, idempotency keys). 2. WS event stream.
3. Seed flow: journal+transcript → summary/quiz generator. AC: an external
   process drives a session end-to-end via the documented API only.

---

## Cross-cutting rules

- One finding → one PR where possible; PRs say which REVIEW finding they
  close.
- Every "Done when" is checked on hardware (iPad + XPS on the same LAN), not
  just localhost.
- No phase starts before the previous phase's "Done when" is recorded as met
  in this file.

## Open decision log (update as decided)

| # | Decision | Options | Default | Owner |
|---|---|---|---|---|
| D1 | Trunk | main vs polish tip | polish tip → main | Kevin |
| D2 | tldraw major upgrade timing | P1-end spike / Phase 2 / stay 3.x | finish P1 on 3.x | Kevin |
| D3 | tldraw production licensing | free non-commercial on 3.x (watermark) / Hobby / Trial / Commercial key / alternative engine | stay free on 3.x unless 4+ upgrade or commercial intent; key required for any 4.x+ | Kevin |
| D4 | iPad local board persistence | persistenceKey / manual snapshot | spike 1.2a | Kevin |
| D5 | Sketchy shapes | rough SVG util / tldraw geo | rough SVG util | Kevin |
| D6 | Recording transport | MediaRecorder+markers / WebRTC / WebCodecs | MediaRecorder+markers v1 | Kevin |
| D7 | Dictation engine | faster-whisper sidecar / speaches / sherpa-onnx | faster-whisper (sidecar or speaches) | Kevin |
| D8 | Wake Lock / iPadOS floor | ship wake lock; require iPadOS ≥ 18.4 (Wake Lock for PWAs + tldraw stroke crash fix) | adopt | Kevin |
| D9 | TEXT editing approach (D-Text) | tldraw native text shape vs custom overlay editor | spike 1.3a | Kevin |
