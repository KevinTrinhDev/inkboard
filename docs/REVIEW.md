# Codebase review — inkboard (2026-09)

A read-through audit of the whole workspace, done as the input to
[ROADMAP.md](./ROADMAP.md) and [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

## 1. What was reviewed and the baseline question

Everything under `apps/`, `packages/`, `infra/`, `scripts/`, `services/`, plus
`docs/` and the CI workflows, at the state of the branch checked out in this
workspace (`final-hardening-pass`, commit `7290298`).

One finding shapes everything below and should be read first:

> **The checked-out snapshot is not the tip of development, and it cannot
> record on any device.** Branch `polish-and-onboarding` (commit `928f4f7`) is
> this snapshot **plus five commits** that fix real, product-blocking defects
> — including "nothing could record on any device". Those fixes are written,
> documented in their commit messages, and pinned by tests, but they have not
> been merged into the branch checked out here (nor into `origin/main`, which
> is older still).

So this review records findings at the checked-out snapshot, marks each one
**already fixed on `polish-and-onboarding`** where that is true, and every
roadmap/implementation recommendation below assumes the five polish commits
are merged first (they are step 0 of the implementation plan).

**Verified baseline (this machine, 2026-09-05):** `pnpm typecheck` ✅, `pnpm
lint` ❌ **only because ESLint lints the ignored-by-git `.claude/worktrees/`
copies** (see P5-1), `pnpm test` ✅ (112 tests: 43 schema + 69 server),
`pnpm build` ✅ when lint is run excluding `.claude`.

## 2. What is already strong (do not regress)

- **The core idea is real and the data model is right.** The board is typed,
  semantic objects (`packages/shared-schema`), rendered semantically, with a
  JSON-Schema export shared between client and server. Nothing about the
  roadmap below changes that.
- **Security posture is thoughtful and unusually well documented** for a
  personal project: local CA + Caddy-only TLS entry, `127.0.0.1`-bound
  Fastify, single-use pairing nonce + domain-separated 30-day session
  credentials, E2E encryption of recordings before they leave the device,
  SVG excluded from the asset allowlist, streaming byte caps, no credential
  in URLs after pairing, and the assumptions written down in
  [SECURITY.md](./SECURITY.md).
- **The sync relay design is disciplined**: records are opaque on the wire
  (a tldraw upgrade cannot break the server), the server is authoritative
  (late joiners get current state), diffs are squash-coalesced over 50 ms
  with intent preserved, remote changes are applied inside
  `mergeRemoteChanges`, and read-only mirrors are enforced server-side.
- **Tests are plentiful and target the failure modes that matter**
  (single-use tokens, replay, takeover, mirror-write refusal, restart
  persistence of the board, path traversal). Stress/`check-sync` scripts
  exercise a live server over real sockets.
- **Careful iOS/Safari engineering** is visible everywhere: touch-action
  scoping, AudioContext resume on gestures, MP4 fallback for
  `MediaRecorder`, pen-vs-touch handling, IndexedDB persistence of the
  recording key.

## 3. Findings

Severity guide: **P0** product cannot do its job; **P1** data loss or wrong
behaviour under realistic conditions; **P2** meaningful UX/edge-case gap;
**P3** perf/scale/robustness; **P4** security & hardening; **P5**
DX/process/docs. Status column: ⚡ = already fixed on
`polish-and-onboarding`; ⭘ = open after polish.

### P0 — product-blocking (all fixed on the unmerged polish branch)

| # | Finding | Where | Status |
|---|---|---|---|
| P0-1 | **No device can record.** The REC button, pre-flight row and timer live in `AppToolbar`, which tldraw renders only for the `editor` (iPad). The `mirror` (laptop — the only device that calls `getUserMedia`) renders **no toolbar at all**, so it has no REC button. The iPad *has* the button but `capture=false` there, so its REC is permanently disabled. Additionally `readyToRecord` requires `pencilReady` (a pen/touch `pointerdown` — never true on a trackpad laptop) and a live `micActive` level meter, so the button would flap on/off with the operator's speech even where it existed. Commit `dd12c20` documents exactly this: "The result was a product that could not record on any device." | `BoardCanvas.tsx:39-42`, `AppToolbar.tsx:200-214`, `useRecordingRig.ts:253-254,174-181`, `App.tsx` | ⚡ `dd12c20` (`RecordingControls.tsx` moved to `AppShell`, gating reworked to latched mic + camera + disk) |
| P0-2 | **The documented two-device setup cannot be completed.** Exactly one pairing QR is minted per server boot (`index.ts` → `printQr()` once) and the pairing nonce is single-use, so whichever device pairs first burns the only token; the second device cannot pair without a server restart, and a restart wipes the in-memory session store, un-pairing the first device. README's "pair both at the same time" is therefore impossible. | `apps/server/src/index.ts:19`, `printQr.ts`, `tokens.ts` (in-memory `activeSessions`) | ⚡ `c0571e0` (per-device token minting, `--pair`, persisted `sessions.json` 0600) |
| P0-3 | **The app tries to load tldraw assets from `cdn.tldraw.com`**, which the server's own CSP (`default-src 'self'`) blocks and which contradicts the "nothing leaves the LAN" premise. Verified in the built bundle (`cdn.tldraw.com` present in the tldraw chunk). | `BoardCanvas.tsx` (no `getAssetUrlsByMetaUrl`), `apps/server/src/app.ts:80-93` CSP | ⚡ `dd12c20` (bundles assets via `getAssetUrlsByMetaUrl`) |
| P0-4 | **PWA icons 404**, so "Add to Home Screen" cannot show a proper tile; `public/icons/README.md` says exactly that ("don't exist yet"). Manifest references `/icons/icon-192.png` and `/icons/icon-512.png`; only a README ships. | `apps/client/public/icons/`, `vite.config.ts:18-21` | ⚡ `dd12c20` (`make-icons.py` + real icons) |
| P0-5 | **Any render-time throw blanks the whole page** — no error boundary, no message, no reload path. On a LAN tool where the server or a board record can be stale this is a realistic failure, and it looks like a dead product. | `App.tsx` | ⚡ `dd12c20` (`ErrorBoundary.tsx`) |

### P1 — correctness / robustness (still open after polish unless marked)

| # | Finding | Where |
|---|---|---|
| P1-1 | **Two live editors ping-pong forever.** When an editor connects, the server kicks any other authenticated editor (`boardSync.ts:183-192`). The kicked client's `useBoardSync` treats the close as a normal disconnect and reconnects with backoff — then *its* hello kicks the first editor, and so on. Two iPads (or one iPad plus a re-pair) that both open `/` flap between "live" and "reconnecting", each cycle throwing away one editor's local state on the snapshot load. The takeover logic is right for a *stale* editor (reconnecting iPad) but there is no way to distinguish "reconnect of the same device" from "a genuinely second pen". | `apps/server/src/ws/boardSync.ts:173-192`; `apps/client/src/board/useBoardSync.ts:233-240,248-256` |
| P1-2 | **A fully-offline iPad loses everything drawn since its last reconnect if the tab/app is killed.** The board is only authoritative on the server; on the iPad it lives in the editor's memory plus the `pending` coalescing buffer. Close the tab mid-lesson with no server reachable and the whole lesson's strokes are gone (the *recording* is safe — that's the offline queue — but the board itself is not). There is no iPad-side persistence of the board, which matters because "the iPad keeps drawing even with no WiFi" is a headline feature. | `apps/client/src/board/useBoardSync.ts:75,88-103`; no `persistenceKey` anywhere |
| P1-3 | **Crash during a take still loses everything since `start()`** (in-memory chunk buffering until `stop()`), and `encryptBlob` then copies the whole take through memory twice on top of that — a realistic long take can exceed an iPad's per-page memory well before the 2 GB server cap. The polish branch's 5 s timeslice shrinks the *window*, not the *buffering*: chunks still accumulate in RAM and are only encrypted+queued at `stop()`. A true fix writes timeslices to IndexedDB as they arrive (see backlog "Not yet fixed"). | `MediaRecorderCapture.ts:45-66,68-87`; `recordingKey.ts:81-92` |
| P1-4 | **`decryptBlob` hardcodes `video/webm`** as the output type, but on iPadOS Safari the recorded container is MP4. Anything that later decrypts a Safari take trusting this type will mislabel it. No production caller today (only the key/queue path encrypts), but the trap is set for the moment decryption/playback lands. | `recordingKey.ts:95-101` |
| P1-5 | **Server restart wipes the board? No — but two state files can diverge.** At HEAD, board state lives under `RECORDINGS_DIR` resolved in `app.ts` (`./apps/server/recordings`) while `uploadRoute.ts` separately resolves the *same env var* against `./recordings` relative to cwd — two different trees depending on how the server is started. `c0571e0` centralizes paths (`paths.ts`), so mark ⚡, but the lesson (defaults must be resolved in one place) stays relevant for new routes. | `app.ts:54-56` vs `uploadRoute.ts:20` | 
| P1-6 | **Heartbeat revalidation depends on in-memory `activeSessions`**, so a credential that was evicted by the cap only stops *new* writes at the next heartbeat — correct behaviour, but it means a device that exceeds the cap keeps editing for up to 30 s. Acceptable; noted for the session-model milestone where eviction semantics need an explicit answer (kick + notice rather than silent eviction). | `boardSync.ts:82-105` |

### P2 — meaningful UX/functional gaps (all open)

| # | Finding | Where |
|---|---|---|
| P2-1 | **The "semantic" TEXT/MATH story is not user-facing yet.** The Text tool places a shape whose text reads "Tap to edit" and cannot actually be edited (plain `BaseBoxShapeUtil`, no editing interaction); the Math tool places a fixed demo equation (`x^2 + 7x + 12 = …`) whose LaTeX cannot be entered or changed. Arrow and Shape tools are literal stubs (fixed horizontal line; plain bordered box — no sketchy rendering, no ellipses/lines, no multi-point arrows). The typed `BoardObject` export path (TEXT/MATH/INK/ARROW/SHAPE with normalized coords + journal) is not fed by the board yet. The README's "every word and equation is saved as data" describes the design, not today's runtime. | `TextShapeUtil.tsx`, `MathShapeUtil.tsx`, `ArrowShapeUtil.tsx`, `RoughShapeUtil.tsx`, `createShapeTool.ts` |
| P2-2 | **The iPad shows a stray black "camera preview" box.** `App.tsx` renders `CameraPreview` whenever `previewVisible` (default true); on the iPad `capture=false`, so `stream` is null and a borderless black `<video>` renders top-right forever. | `App.tsx:22-26`, `CameraPreview.tsx:42-56` (⚡ on polish: gated on `rig.capture`) |
| P2-3 | **Camera failure is unrecoverable without a reload.** `getUserMedia` runs once on mount; a denied/misbehaving prompt leaves `cameraError` set and no Retry. (⚡ `dd12c20` adds Retry + friendlier errors on polish.) | `useRecordingRig.ts:82-104` |
| P2-4 | **Page navigation is one-directional** — "new/next page" only moves forward and never lets you go back to page 1 without re-creating state; no page list, no naming, no reordering, and "pages" are tldraw pages whose names the user never sets. For a lecture with a board that fills up, this is the difference between "next page" and usable paging. | `AppToolbar.tsx:78-87,177-184` |
| P2-5 | **No way to see or retrieve past sessions from any device.** Recordings exist only as ciphertext `.webm.enc` on the server plus metadata nobody lists; the recording key lives only on the iPad that recorded — so the natural "browse my past lessons" UI belongs on the iPad (it is the only device that can decrypt), and there is no such UI and no metadata endpoint. | server has no session index; client has no browser |
| P2-6 | **First-run experience is a wall of text and a QR deep-link.** The unpaired screen has no in-app steps for installing the CA profile vs pairing vs opening the mirror, and no troubleshooting when pairing fails (stale token, token consumed, wrong origin). | `PairingGate.tsx:95-106` |
| P2-7 | **No feedback when the pen tool is not what the user expects.** Pencil readiness is a tiny dot row in the editor toolbar on the iPad; the mirror (capture device) shows its own gating. After polish this is usable, but the semantics of the checklist dots are only explained in docs, not in the UI. Low effort, high clarity win: tooltip/tap-to-explain on each dot. | `PreflightChecklist.tsx` |

### P3 — performance / scale

| # | Finding | Where |
|---|---|---|
| P3-1 | **The whole board is re-serialized to JSON on every debounced save and re-sent in full on every (re)connect.** Fine for one lesson; becomes the dominant cost once boards are long-lived (the board is never cleared today) and reconnect-heavy. The journal/`fromOp` resync design in `docs/API.md` exists precisely to fix this and is unused. | `boardState.ts:105-131`; `boardSync.ts:199-206` |
| P3-2 | **Nothing ever clears a board or evicts assets** (recorded as a deliberate limitation in SECURITY.md). Combined with P3-1 and the asset-size headroom, a semester of use fills disk and slows every save. Needs the session/board model before it can be fixed properly. | `boardState.ts`, `assetRoutes.ts` |
| P3-3 | **`snapshot()` returns the live internal record map** (aliasing). Every current caller only reads it, so this is safe today — but it is a foot-gun: the next caller that mutates the result corrupts the authoritative board in place. Cheap hardening: return a frozen copy or document the invariant on the method. | `boardState.ts:62-64` |

### P4 — security & hardening (open items; several already documented)

| # | Finding | Where |
|---|---|---|
| P4-1 | **Asset URLs are bearer capabilities that never expire** and `GET /api/assets/:id` is unauthenticated by necessity (`<img>` can't send headers). Documented as accepted. Real fix when wanted: short-lived signed URLs with expiry, or a per-session cookie on the board origin. | `assetRoutes.ts:96-125`, SECURITY.md |
| P4-2 | **No pairing audit trail.** A lost/stolen device or a curious guest leaves no record of when/what paired (though pairing is single QR-at-boot today, so the surface is small). Cheap, useful forensics; also becomes important if tokens become per-device (polish). | `pairingRoutes.ts`, `tokens.ts` |
| P4-3 | **The 5-minute QR token is printed to the server log and embedded in a deep link** (`?token=…`) that can end up in Caddy's access log and browser history. Single-use + short TTL bounds the damage; acceptable, but a `log`-aware pairing link (hash fragment instead of query) would keep it out of logs entirely. | `printQr.ts:10`, `PairingGate.tsx:54-56` |
| P4-4 | **Recording key has no export/recovery** and lives raw in IndexedDB (extractable by design). Documented as a deliberate trade-off. Before real (non-test) use, add an explicit backup/export flow; otherwise a single "Erase All Content" loses every past lesson permanently. | `recordingKey.ts`, SECURITY.md |
| P4-5 | `uploadRoute.ts` still authenticates via a header named **`x-pairing-token`** that now carries the *session* credential, while `assetRoutes.ts` uses `Authorization: Bearer`. Cosmetics, but the misleading name is a foot-gun for the next person (and for agent API work in M4). Unify on `Authorization: Bearer`. | `uploadRoute.ts:32`, `syncManager.ts:33` |

### P5 — DX / process / docs

| # | Finding | Where |
|---|---|---|
| P5-1 | **`pnpm lint` is red on this machine** because `eslint .` walks the git-ignored `.claude/worktrees/` copies (ignored by a *global* gitignore, which ESLint doesn't know about) and the scripts there aren't covered by the node-globals block. CI is green only because a fresh clone has no `.claude`. ⚡ already fixed upstream (`eslint.config.mjs` now ignores `**/.claude/**`, with a comment explaining why); verify the bare gate is green on the merged trunk. | `eslint.config.mjs:4-12` |
| P5-2 | **Branch sprawl / stale trunk.** `origin/main` was behind both active feature branches; `final-hardening-pass` and `polish-and-onboarding` diverged; three worktrees of old branches live under `.claude/worktrees/`. Docs described behaviour of earlier passes and contradicted the code (record button, pairing-many-devices, "done on hardware" claims). ⚡ trunk now fast-forwarded to the polish tip (`main` = `928f4f7`); remaining work: delete stale worktrees/branches and keep docs in the same commits as the behaviour they describe. | repo state |
| P5-3 | **No client tests and no browser e2e.** All client logic (sync, queue, crypto, pairing) is only exercised by server-side + manual tests. The pure logic (squash/queue/key) is easily unit-testable, and a Playwright pass over the built app against the real server would have caught P0-1/P0-2 class bugs. | `apps/client/package.json` |
| P5-4 | **`pnpm test` does not run client tests and requires `shared-schema` to be built first** (apps import its `dist`); the root `typecheck` handles the build, `test` does not, so `pnpm test` on a fresh clone can fail until a build has happened. Tighten the scripts so the gate is self-sufficient in dependency order. | `package.json:11-13` |
| P5-5 | Stale comments: `tokens.ts` still says credentials are stamped with a generation so "at most one device is ever trusted at a time", which the multi-device epoch model replaced. Doc-comment drift in the same file that explains security semantics is worth keeping truthful. | `tokens.ts:20-27` |

## 4. Docs vs reality (drift worth fixing in the same pass)

| Doc claim (checked-out docs) | Reality at this snapshot |
|---|---|
| README: laptop mirror has "the record button" | No record button exists anywhere usable (P0-1) |
| README: "Both can be paired at the same time; that is the normal setup" | Only one QR per boot; second device cannot pair (P0-2) |
| SECURITY.md: several devices pair at once, eviction LRU | Cap logic exists, but you can never *obtain* a second token (P0-2) |
| ROADMAP M0.5: "still needs a pass on real iPad hardware" | Hardware passes happened in later commits; docs not updated |
| BACKLOG: various "Next" items (reconnect status, session browser…) | Reconnect status exists; session browser does not; several "done" claims predate the record/pairing regressions |

## 5. Ecosystem & tooling opportunities

Research round (2026-09): primary sources fetched live; each subsection ends
with confidence notes. This section is what the roadmap's "decision gates"
point at.

### 5.1 Canvas engine: tldraw licensing, versions, upgrade path

Primary sources: [npm registry](https://registry.npmjs.org/tldraw), [tldraw releases](https://tldraw.dev/releases), [LICENSE.md](https://github.com/tldraw/tldraw/blob/main/LICENSE.md), [license-key docs](https://tldraw.dev/sdk-features/license-key), [sync docs](https://tldraw.dev/docs/sync), [persistence docs](https://tldraw.dev/docs/persistence), [image export](https://tldraw.dev/sdk-features/image-export), [text shape](https://tldraw.dev/sdk-features/text-shape), GitHub issues #10284/#10285/#9239/#9783.

1. **Version status.** npm `tldraw` `latest` is **5.4.0** (2026-09-02). 3.15.0 (2025-07) → **4.0.0 (2025-09-18)** → **5.0.0 (2026-05-06)** → 5.4.0. Our resolved 3.15.6 (2026-02-11) is the last 3.15.x patch. tldraw does **not** use semver: minors can break. The "stay on 3.x forever" assumption is not maintenance — it is deliberately freezing two majors behind.
2. **Licensing is the deciding factor.** The SDK is **source-available under the custom "tldraw license"**, not OSI open source: default terms allow development only; **production requires a license key** (client-verified, host-scoped). Enforcement: on **3.15.6** unlicensed production shows the "made with tldraw" watermark (no hard stop); on **4.0+** it logs and **hides the editor after ~5 s**. Keys: Trial (100 days), Commercial (paid), Hobby (non-commercial, watermark stays). Loopback/localhost/non-HTTPS count as development; a **LAN-over-HTTPS deployment does not** — so inkboard as actually used (Caddy HTTPS on the LAN) is in the gray zone where a key is legally required but only SDK-enforced from 4.0 onward. **This decision must be made explicitly** (see decision log D3): current free non-commercial use is fine on 3.15 (watermark), but *any* commercial intent, or an upgrade past 3.x, requires a Hobby/Commercial/Trial key wired into the client (one line: `licenseKey`).
3. **Upgrade cost is real** if we move. v4.0 breaks: license enforcement, CSS var renames (`--tl-*`), `Geometry2D.isLabel` → `excludeFromShapeBounds`, arrow `text` → `richText`, event propagation. v5.0 breaks custom shapes hardest: `ShapeUtil.indicator()` (JSX) → `getIndicatorPath()` (`Path2D`), brush/handle/selection overlays → canvas `OverlayUtil` classes, theme system removal (`useDefaultColorTheme`, `FONT_FAMILIES`, `STROKE_SIZES`), `<Tldraw>` props moved to `options`, per-mount `assetUrls`, new `AssetUtil`/`users` APIs. v5.2 broke collaborator types; v5.3.1 fixed an iOS inset-touch bug. Migration scope: our shape utils, tools, asset store, and any CSS overrides.
4. **Self-hosted multiplayer is NOT a separate paid product**: `@tldraw/sync` (client) and `@tldraw/sync-core` (`TLSocketRoom`, `SQLiteSyncStorage`) are in the SDK (`premium:false`), same license regime. Hosted tldraw.com sync SaaS is gone (only a free demo with ~1-day rooms). So our custom relay could be compared with/partially replaced by `TLSocketRoom` under the same license — a Phase-2/3 option, not a requirement. The new paid-premium tier (v5.3+, `premium:true`) is `@tldraw/collaboration`/`commenting` — not needed.
5. **Export**: `getSvgElement`/`getSvgString`/`toImage` (PNG/JPEG/WebP/SVG) stable in 3.15.6 and 5.4.0; `toImageDataUrl` added in 4.0; **no `toPdf` in any version** (verified in source). `TldrawImage` exists (needs `licenseKey` in later versions). Browser/DOM-only export.
6. **Text editing exists in tldraw itself**: the built-in `text` shape (`TLTextShape`, rich text, TipTap editing, double-tap to edit, auto-size) works headless (toolbar hidden). Inkboard's stub `TextShapeUtil` could be **replaced by tldraw's native text shape** for free editing, at the cost of a mapping step to the semantic TEXT object (richText → plain content). Decision D-Text in the plan.
7. **Persistence**: `persistenceKey` (IndexedDB document + assets, cross-tab) exists through 5.4.0. **No official Yjs binding** exists (docs removed in 2025); Yjs is DIY. Our P1-2 (iPad offline durability) can use `persistenceKey` + server reconciliation or an explicit snapshot cadence — spike decides.
8. **iPad-specific GitHub issues to keep on the radar**: #10284 (iPadOS desktop-UA handling of gestures, open), #10285 (pencil double-tap-zoom suppression is dead code, open), #9239 (draw-tool stroke **crash on iOS 18.2–18.3.x**, fixed in 18.4+ — another reason to require iPadOS ≥ 18.4, same floor as Wake Lock), #9783 (blank canvas ~1–2 s on iPadOS 26.5, likely WebKit transient). Not "tldraw is broken on iPad" — but plan real-device testing per release.

### 5.2 iPadOS Safari capability facts that change design decisions

All version-anchored (iPadOS 26.x era), primary sources (MDN BCD, caniuse,
WebKit Bugzilla, Apple Safari release notes):

| Capability | Verdict for inkboard | Evidence |
|---|---|---|
| Screen Wake Lock | **Use it**: works for Home-Screen PWAs from **iPadOS/iOS 18.4** (browser-mode earlier, PWA mode was broken until then — WebKit bug 254545). Foreground PWA can hold the screen awake through a lecture; lock releases on backgrounding; request from a user gesture. The old "silent video" hack no longer works on iPad. | [bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545), [caniuse](https://caniuse.com/mdn-api_wakelock), [Safari 18.4 notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes#Home-Screen-Web-Apps) |
| Screen Orientation lock | **Do not build on it**: not supported on any Safari/iPadOS, including standalone PWAs (`NotSupportedError` for multitasking-capable apps). Design for both orientations / Control-Center lock. | [MDN BCD ScreenOrientation](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ScreenOrientation.json), [caniuse](https://caniuse.com/mdn-api_screenorientation_lock), [bug 257695](https://bugs.webkit.org/show_bug.cgi?id=257695) |
| MediaRecorder on iPad | MP4/H.264+AAC only (no WebM) — matches the code's MIME fallback. Recording **does not survive backgrounding or screen lock**; open Safari 26-era bug where an ~20 s MP4 take freezes ~15 s in ([bug 315091](https://bugs.webkit.org/show_bug.cgi?id=315091)); earlier iOS-26 corruption regression fixed ~26.2. Rule: keep the recorder foregrounded + wake lock, record short segments. | [caniuse mediarecorder](https://caniuse.com/mediarecorder), [bug 315091](https://bugs.webkit.org/show_bug.cgi?id=315091), [bug 280394](https://bugs.webkit.org/show_bug.cgi?id=280394) |
| WebCodecs | VideoEncoder on Safari/iPadOS 16.4+; **AudioEncoder only from Safari 26**. Apple encode is H.264/HEVC (VideoToolbox); VP8/9/AV1 encode absent — gate with `isConfigSupported`. Not a MediaRecorder drop-in (you own muxing/rate control). Revisit only for low-latency segmented capture on the laptop. | [MDN VideoEncoder](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/VideoEncoder.json), [WebKit WWDC25](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [bug 281945](https://bugs.webkit.org/show_bug.cgi?id=281945) |
| getUserMedia on iPad | Still needs a secure context (fine — Caddy local HTTPS). **Permission persistence is the real risk**: WebKit bug 280394 open — no "always allow" UI on iOS; expect a prompt on each cold start / after screen-off; a PWA launch can even revert Safari's per-site Allow to Ask (bug 215884, iOS 18.5-era). Design: one gesture-driven prompt per lecture start; never tear down/restart capture mid-flow; resume AudioContext from a user gesture. | [bug 280394](https://bugs.webkit.org/show_bug.cgi?id=280394), [bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884) |
| IndexedDB quotas | No Apple-published cap; the old "~1 GB/origin" is community-reported. Home-Screen apps are exempt from ITP's 7-day script-writable cap ([WebKit blog](https://webkit.org/blog/11338/cname-cloaking-and-bounce-tracking-defense/)), but multi-GB blobs are still evictable under disk pressure. **Rule: stream recordings off-device in segments; never trust GB-scale on-device storage** (reinforces P1-3/Phase-3 design). | [bug 209501](https://bugs.webkit.org/show_bug.cgi?id=209501), [localmode matrix](https://localmode.dev/blog/compatibility/safari-ios) |
| SW/PWA updates | Home-Screen apps check for SW updates on launch/navigation only; stale-app-shell after redeploy is a documented pain on iOS. Serve `sw.js` no-cache, keep assets content-hashed, expect occasional double-relaunch to activate. Relevant because the client is rebuilt and redeployed frequently over the LAN. | [herdbook #72](https://github.com/taco/herdbook/issues/72), [qr-code-generator #33](https://github.com/pedrosanzmtz/qr-code-generator/issues/33) |
| storage.persist()/estimate() | `persist()` exists but iOS never shipped Chrome-style durable storage (bugs 209501/209563 open); `estimate()` Safari 17+. Treat persist() as advisory; don't build quota logic on estimate precision. | [MDN StorageManager](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/StorageManager.json), [bug 209501](https://bugs.webkit.org/show_bug.cgi?id=209501) |

### 5.3 Speech-to-text and math (M2 / Phase 4)

- **faster-whisper is current and the right engine** (v1.2.1, Oct 2025, MIT).
  On the 3050 Ti (4 GB): `large-v3` needs int8 to fit; short-phrase decode
  with base/small is ~0.2–1 s — fast enough for "tap, speak, text". Official
  3070-Ti numbers: 13-min clip, large-v2 fp16 ≈ 63 s / 4.5 GB VRAM.
  whisper.cpp ≈ parity on NVIDIA (official 1m03 vs 1m05) — no reason to
  switch from the CTranslate2 plan. CUDA12/cuDNN toolchain needs
  `ctranslate2` pinned (4.4.0 vs ≥4.5). [faster-whisper PyPI](https://pypi.org/project/faster-whisper/), [GitHub](https://github.com/SYSTRAN/faster-whisper)
- **Best-maintained HTTP wrapper today: `speaches`** (speaches-ai, MIT, the
  successor of fedirz/faster-whisper-server): OpenAI-compatible API, SSE
  streaming, Docker. [speaches](https://github.com/speaches-ai/speaches)
- **Native iPad dictation is not an option for this product**: Safari's
  `SpeechRecognition` (iOS ≥14.5) is Apple-cloud backed (audio leaves the
  device) and interim results are flagged unreliable — violates the offline
  LAN premise. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [caniuse](https://caniuse.com/mdn-api_speechrecognition_start)
- **Lightweight CPU fallback if ever needed: sherpa-onnx** (Apache-2.0,
  very active, streaming zipformer transducer models); Vosk is stale;
  **Coqui STT is dead** (company shut, README says unmaintained).
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- **Captions: write SRT/VTT from faster-whisper segment/word timestamps
  yourself. stable-ts is archived — do not adopt.** WhisperX (BSD-2, active)
  only if speaker diarization is required later. [whisperX](https://github.com/m-bain/whisperX)
- **Handwritten-math → LaTeX: pix2tex/LaTeX-OCR** (MIT) remains the OSS
  standard but is dormant (last push Jan 2025); image-based (rasterize ink
  first), runs locally on the GPU. No maintained *stroke-native* OSS
  recognizer exists (MyScript/Mathpix are commercial). Defer; a later
  "scribble → MATH object" milestone. [LaTeX-OCR](https://github.com/lukas-blecher/LaTeX-OCR)
- transformers.js/WebGPU whisper on the iPad exists but is tens-hundreds MB
  downloads with multi-second latency — not a production path vs. the LAN
  server GPU. Revisit only as a no-server fallback.

### 5.4 Handwriting fonts, sketchy shapes, export, persistence, UX

- **Handwriting font for TEXT: Playpen Sans confirmed** — OFL 1.1 (free to
  ship), variable weight 100–800, **7 automatic alternates per character
  with a built-in shuffler** (TypeTogether repo), designed for handwriting
  education. Shantell Sans (also OFL) is the bouncier "marker" alternative
  with BNCE/INFM/SPAC axes. Self-host woff2 with unicode-range subsets from
  google/fonts or Fontsource. [Playpen OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/playpensans/OFL.txt), [TypeTogether](https://github.com/TypeTogether/Playpen-Sans), [Shantell](https://github.com/arrowtype/shantell-sans)
- **Rough.js is effectively unmaintained** (4.6.6, Nov 2023; Excalidraw
  keeps a fork) and there is **no maintained tldraw 3.x wrapper** — sketchy
  rendering means writing rough SVG into `ShapeUtil.toSvg` yourself, or
  using tldraw's native geo styling. Small scope either way.
- **Export**: tldraw 3.x has stable `getSvgElement`/`getSvgString`/`toImage`
  (PNG/SVG/JPEG/WebP; fonts embedded via FontEmbedder); **no `toPdf`** —
  PDF is assembled client-side (pdf-lib) per tldraw's own example. Export is
  browser/DOM-only (not server-side). [tldraw image export](https://tldraw.dev/sdk-features/image-export)
- **Offline persistence**: `persistenceKey` auto-persists document+assets to
  IndexedDB (still present in current tldraw) with same-key tab sync; no
  official Yjs binding exists — combining `persistenceKey` with the LAN
  server means two writers to one store, so either Yjs-with-y-indexeddb as
  the local cache, or `persistenceKey` + periodic snapshot uploads, or the
  app's own snapshot cadence (P1-2 spike decides). [tldraw persistence](https://tldraw.dev/sdk-features/persistence)
- **Pen/touch UX**: Pointer Events `pointerType` works on iPadOS Safari
  13.4+ (pen-vs-finger switching, palm-rejection heuristics); Apple Pencil
  double-tap is not exposed to the web; `navigator.vibrate` unsupported on
  iOS (no web haptics — use visual/audio feedback). Reference UI patterns:
  Excalidraw (MIT) floating palette + stylus strokes; OpenBoard (GPL-3.0)
  page-based teaching UX.

## 6. Decision points the roadmap must answer

1. **Trunk strategy** — merge `polish-and-onboarding` first (recommended; it
   is the current tip with the P0 fixes) vs. cherry-picking.
2. **tldraw license posture (D3)** — this project's LAN-over-HTTPS use sits
   outside tldraw's "development" carve-out, so the choice is: stay free on
   3.15 with the watermark for non-commercial use, or obtain a Trial/Hobby/
   Commercial key (needed for any 4.x+ upgrade, which hard-stops unlicensed
   production). Decide before upgrading majors.
3. **tldraw upgrade appetite (D2)** — stay on 3.x (known APIs, watermark) vs.
   a majors-upgrade spike (4.0/5.0 breaking changes are enumerated in §5.1).
   Default: finish Phase 1 on 3.x, upgrade in Phase 2's dependency wave.
4. **Text entry interaction** — the single biggest product question: tldraw's
   own `text` shape gives in-place editing for free (rich-text → semantic
   mapping needed) vs. a custom editor on the current `TextShapeUtil`; plus
   how math LaTeX entry and dictation fit the flow.
5. **Session/board model** — when boards become per-lesson sessions and the
   journal/typed-object layer (API.md) gets implemented; the iPad gets local
   board persistence (P1-2) either way.
6. **iPadOS floor** — set ≥ **18.4**: below that, Wake Lock doesn't work in
   PWAs (§5.2) and tldraw draw strokes crash Safari on 18.2–18.3.x (§5.1).
7. **Recording transport** — keep MediaRecorder + durable chunked capture
   (P1-3) as the v1; WebRTC/WebCodecs only if a live pipeline (Phase 3)
   demands it (iPadOS facts in §5.2 bound what is possible).
