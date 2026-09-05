# Roadmap

Sequential build plan, grounded in the actual state of the code (reviewed
2026-09, see [REVIEW.md](./REVIEW.md) for the findings behind every phase and
the tooling choices with sources). The day-to-day task list lives in
[IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) (tickets with files and
acceptance criteria); [BACKLOG.md](./BACKLOG.md) is the idea vault of
everything cross-cutting that is not yet committed to a phase.

Legacy milestone letters (M0…M5) from earlier passes are mapped to the new
phases below so nothing is lost.

---

## Reality check first

The vision (two devices, one board, semantic data instead of video) is mature
and the architecture is right. But the *product loop* had never run
end-to-end on the intended hardware until the Phase-0 merge fixed the blockers:

- **Nothing could record on any device** — the laptop mirror rendered no
  toolbar and the gate logic required a pen + a live mic level on the
  capture device (REVIEW P0-1). **Fixed** by merging `polish-and-onboarding`.
- **The documented two-device setup could not be completed** — one QR per
  boot, single-use nonce, restart wiped sessions (REVIEW P0-2). **Fixed** by
  the same merge (per-device tokens, restart-surviving sessions).
- **tldraw assets loaded from `cdn.tldraw.com`**, blocked by the app's own
  CSP (REVIEW P0-3). **Fixed** by bundling assets upstream.

> **Phase 0's merge is done (`main` = `928f4f7`).** The remaining Phase-0
> work is proving the first real end-to-end take and trunk hygiene; Phase 1
> (one complete lesson) builds on that baseline.

---

## Phase 0 — Merge & first real take (baseline)

> **Status: merge done 2026-09.** `polish-and-onboarding` is integrated into
> the trunk (`main`, commit `928f4f7`): record control on the capture
> device, per-device pairing tokens + restart-surviving sessions, one-command
> startup, real icons, error boundary, `.claude` lint ignore. Remaining
> Phase-0 work is the *verification tail*: first real end-to-end take on
> hardware and CI/trunk hygiene.

Get the two-device product actually working once, on the real hardware, and
make the trunk + docs honest again.

- ~~Merge `polish-and-onboarding` into the trunk~~ done — `main`
  fast-forwarded to `928f4f7`.
- ~~Ignore `.claude/worktrees/` in ESLint~~ done upstream — `eslint.config.mjs`
  ignores `**/.claude/**` (REVIEW P5-1); verify the bare gate is green now.
- Delete stale worktrees/branches; make CI run on the trunk branch (REVIEW
  P5-2). CI currently only runs on `main` PRs and `main` is stale.
- Keep the docs that describe behaviour aligned with the merged code (README
  record-button / pairing claims, SECURITY restart semantics) — docs and
  behaviour land in the same commits from here on.
- **Done when:** pair the iPad and the laptop with two QR codes; a stroke on
  the iPad appears on the laptop mirror; REC on the laptop records a take
  that encrypts, queues and uploads; the `.webm.enc` lands on the server; a
  server restart does not un-pair either device; `pnpm typecheck && pnpm lint
  && pnpm test && pnpm build` are green on the trunk, locally and in CI.

Resolves REVIEW: P0-1…P0-5, P5-1, P5-2, doc drift.

## Phase 1 — One complete lesson on one board

Make the single-lesson teaching loop trustworthy and complete. This is the
"product" phase: a teacher can give a real lesson and walk away with a saved,
exportable take, without babysitting the tool.

- **Pen ownership, made robust** (P1-1): takeover must distinguish "the same
  iPad reconnecting" from "a genuinely second pen"; a second live editor is
  told so in the UI instead of silently ping-ponging.
- **The iPad never loses the board again** (P1-2): local persistence of the
  drawing surface (tldraw `persistenceKey` or explicit snapshot cadence —
  decision in implementation plan), reconciled with the server-authoritative
  copy on reconnect.
- **Real text and math entry** (P2-1, the biggest product gap): in-place
  editing of TEXT shapes; LaTeX entry with live KaTeX preview for MATH; the
  semantic content actually reaches the record. First-class "tap the text
  tool, dictate a phrase" path (see P4) lands here as the fast way to type.
- **Real arrow and shape tools** (P2-1): multi-point arrows and
  sketchy-style rect/ellipse/line (decision: hand-rolled rough SVG in
  `ShapeUtil.toSvg` vs. tldraw native geo styling — see REVIEW §5).
- **Style basics**: ink color/width for the four object types; consistent
  with the semantic schema (color fields already exist on INK/ARROW/SHAPE).
- **Pages you can use** (P2-4): previous/next/rename/list; page numbers on
  the board.
- **Export per page** — PNG via tldraw's export API; PDF assembled
  client-side (pdf-lib), which is the documented browser pattern (REVIEW §5).
- **Recording durability** (P1-3): MediaRecorder timeslices appended to
  IndexedDB as they arrive; encrypt/queue on stop without a whole-file memory
  copy. Cuts the crash-loss window from "the whole take" to "≤ one
  timeslice".
- **Polite capture UX**: camera error with Retry already on the polish
  baseline; add visible mic level and keep the recorder's own `onerror`
  surfaced in the UI.
- **A lesson-appropriate screen**: adopt **screen Wake Lock** on the iPad
  editor (supported for Home-Screen PWAs from **iPadOS 18.4** — REVIEW §5.2)
  so a long lecture does not dim mid-stroke; release it when recording
  stops. **Set iPadOS ≥ 18.4 as the supported floor** (Wake Lock needs it,
  and tldraw draw strokes crash Safari on 18.2–18.3.x — REVIEW §5.1).
- **Client tests + first e2e** (P5-3): unit tests for the pure client logic
  (queue, squashing is already covered in schema, crypto round-trip) and a
  Playwright spec that drives the real built client + server through
  pair → mirror → record → upload.
- **Decision gate — tldraw majors**: run a short spike on upgrading tldraw
  3.15 → 4/5 (custom shape/tool APIs, licensing implications — see REVIEW
  §5) and decide stay-vs-move before building more custom shapes on the
  current API. Default: finish P1 on 3.x, upgrade in P2 unless the spike
  shows a blocking reason.

- **Done when:** an entire real lesson (30+ min): teacher writes
  text/math/arrows/shapes across named pages on the iPad; the laptop records
  camera+mic for the whole lesson; a mid-lesson iPad Safari kill loses at
  most the current take's last timeslice and nothing off the board; a page
  exports to PNG and the whole board to a PDF; both devices reconnect after
  WiFi drops and server restarts without user action.

Resolves REVIEW: P1-1, P1-2, P1-3, P2-1, P2-4, P2-5 (part), P3-3, P5-3.
Legacy M1 items that depend on a real timeline (WebRTC/journal sync) move to
Phase 3; export utilities from the old "Next" backlog land here.

## Phase 2 — Sessions and the semantic layer

Turn "board as data" from an architecture into the product. Everything here
is why the project is *not* a screen recorder.

- **Multi-session model on the server**: boards become named, listable,
  archived sessions; a lesson starts a fresh board and the previous one is
  kept. This is the prerequisite for every search/GC/API item below.
- **Journal + typed objects, for real** (P2-1 tail): export tldraw records →
  normalized `BoardObject`s (TEXT/MATH/INK/ARROW/SHAPE) with per-session
  monotonic `opId` events (the schema and `GET /api/schema` already exist);
  implement `GET /api/sessions/:id/journal?fromOp=N` and the resync client
  (API.md design target), so reconnects stop re-sending whole boards
  (P3-1).
- **Storage bounds** (P3-2): per-session asset ownership + GC, board
  eviction rules, a "storage used" readout. Resolves the two documented
  "unbounded" limitations.
- **Recording session index**: metadata per take (time, duration, size,
  container, session board id) served to paired devices — the substrate for
  a UI.
- **iPad session browser + playback**: the iPad lists its own past sessions
  and decrypts/plays them (fix the hardcoded-WebM type first — P1-4). Add
  the deliberate **key export/backup flow** (P4-4) so "Erase All Content"
  cannot orphan a semester of recordings.
- **Hardening batch** (P4): pairing audit log; unify auth header on
  `Authorization: Bearer`; freeze snapshots returned by `BoardState`;
  decision and (if wanted) implementation of expiring asset URLs.
- **Dependency modernization wave** (P5-DX): tldraw majors (per Phase-1
  gate), React 18→19, Vite 6→8, Zod 3→4, TS 5.9→7, eslint 9→10, Vitest
  2→5 — one coordinated, staged effort with the verification gate green
  after each stage (see implementation plan for the risk order).
- **Search spike**: full-text over session TEXT/MATH content — the genuine
  differentiator, cheap once the journal is real.

- **Done when:** two lessons live as two sessions; each exports a typed
  journal JSON; the iPad can list and play back its own old recordings
  after re-pairing a restarted server; an external program replays a
  session from the journal API without the UI; the dependency wave is
  merged with the gate green.

Resolves REVIEW: P1-4, P1-6, P2-5, P3-1, P3-2, P4-2, P4-4, P4-5.
Legacy M4 (agent API) starts here (journal/objects endpoints) — see Phase 6.

## Phase 3 — Live pipeline and the renderable timeline (legacy M1)

Replace/augment upload-on-stop so a session is a *timeline* that can be
re-rendered later without re-recording: board events and camera/mic in one
time frame, stored as data.

- Decide transport (decision in implementation plan, informed by REVIEW §5):
  keep MediaRecorder-on-laptop (now durable from P1) and record wall-clock
  timeline markers, vs. live WebRTC P2P vs. WebCodecs local encode. The
  capture device is the same machine as the server, so "live" is local.
- Record journal events with timestamps as the board changes during a take,
  so a stroke's appearance time is known.
- A compositing/render pass: vector board + facecam (+ optional ink replay
  in real time) → MP4 master, runnable without re-recording.
- **Done when:** a stored session re-renders to an MP4 from the recorded
  data alone, with ink appearing in sync with the voice track.

## Phase 4 — Voice, at teaching speed (legacy M2)

Make spoken words become board text fast enough to use live.

- Wire the faster-whisper sidecar (see REVIEW §5 for the current best server
  wrapper/model for the RTX 3050 Ti and whether a smaller/lighter engine is
  the better default for short phrases).
- "Tap the text tool, speak" inserts a TEXT object at the tapped position;
  correctable before commit; also dictation straight into an open text
  editor. (Note: Safari's built-in `SpeechRecognition` is **not** an option —
  it is Apple-cloud backed, so audio would leave the LAN — REVIEW §5.3.)
- SRT/VTT export from a take's transcript (feeds subtitle/publishing work).
- **Done when:** tap → speak → text on the board round trip is fast enough
  to use mid-lesson (target: text visible within ~1 s of phrase end on the
  LAN).

## Phase 5 — Handwriting look, localization, publishing (legacy M3 + M5)

- Wire Playpen Sans (confirmed OFL, variable font, built-in 7-alternate
  shuffler — REVIEW §5) into TEXT rendering, self-hosted as woff2 subsets,
  with a deterministic per-object seed so re-renders match. Add the small
  controlled irregularity layer on top; 90% of the effect from the font
  itself.
- Localization: generate translated TEXT/MATH objects at the same positions
  from a source board + transcript (dub/subtitles per language) per the
  API.md model.
- **Done when:** one recorded session can produce a second language's video
  without touching the original take, and TEXT looks handwritten but stays
  legible at board sizes.

## Phase 6 — Agent API (legacy M4, completion)

- Finish the design-target surface from API.md on top of Phase-2 sessions:
  `POST /api/sessions/:id/objects`, journal resync, WS event stream.
- Define agent auth (separate from human device pairing), rate limits, and
  an idempotency story for programmatic board writes.
- Seed one concrete agent flow: consume a session journal + transcript to
  produce a study summary or quiz (the "AI co-teacher" from the backlog).
- **Done when:** an external process drives a session end-to-end using only
  the documented API.

---

## Sequencing rules

1. A phase ships only when its "Done when" holds on real hardware, not just
   localhost.
2. Every phase keeps the verification gate green at each commit:
   `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
3. Cross-cutting backlog items stay uncommitted until a phase needs them;
   BACKLOG.md ranks by impact/effort for when they are picked up.
4. Phases 0–2 harden and productize what exists; Phases 3–6 build the
   original M1–M5 vision on top. Nothing in 3–6 is attempted before 0–2
   because all of them depend on a recording loop that actually runs.
