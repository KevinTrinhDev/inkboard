# Hardware acceptance checklist (iPad + XPS on the same LAN)

What an agent on the XPS cannot verify by itself — the physical iPad, its
camera/mic prompts, Apple Pencil, and Home-Screen PWA behaviour. Run through
this after every Phase that touches these paths, and record the result + date
at the bottom. Everything else (server, relay, sockets, stress, HTTPS) is
covered by `pnpm test`, `scripts/check-sync.mjs`, `scripts/stress-sync.mjs`
and the CI gate.

## Setup (once)

- [ ] `avahi-utils` installed so `inkboard.local` resolves from the iPad:
      `sudo apt install avahi-utils` (fallback: use `https://<lan-ip>`, which
      Caddy also serves a certificate for — verified working).
- [ ] iPad trusted the local CA: open `https://inkboard.local/inkboard-ca.crt`
      in Safari → install Configuration Profile → enable full trust in
      Settings → General → About → Certificate Trust Settings.
- [ ] iPad OS ≥ 18.4 (floor: Wake Lock in PWAs + tldraw stroke-crash fix).

## Phase 0 gate (first real two-device take)

- [ ] Pair the **iPad** by scanning the board QR → `https://inkboard.local`
      shows the board (not "Not paired").
- [ ] Pair the **laptop** camera view with the second link →
      `https://inkboard.local/mirror` shows the board read-only.
- [ ] Draw on the iPad with the Apple Pencil → stroke appears on the laptop
      mirror as you draw (latency acceptable, no Safari page-pan).
- [ ] REC on the laptop: pre-flight dots go green (camera, mic, disk), REC
      starts/stops, timer runs, "waiting to sync" count clears.
- [ ] Server restart (`./infra/scripts/dev-up.sh` again) → **no re-pair
      needed**; devices reconnect on their own and receive the board.
- [ ] iPad sleeps / WiFi drops mid-session → reconnects and receives the
      current board, nothing drawn is lost after reconnect.

## Phase 1 (per-ticket checks once implemented)

- [ ] TEXT: type/edit a sentence in place on the iPad (IME, multi-line, undo).
- [ ] MATH: enter LaTeX with live preview; mirror shows the same render.
- [ ] Arrow + rough rect/ellipse/line draw correctly with the Pencil.
- [ ] Second iPad opening `/` gets "another device has the pen" (no
      ping-pong) and can explicitly take over.
- [ ] Draw with the server stopped, kill the iPad tab, reopen → board
      reappears from local storage; server return converges the board.
- [ ] Kill the tab mid-recording → relaunch lists the interrupted take;
      Resume/Discard works; no whole-take loss (≤ one timeslice).
- [ ] Wake Lock: screen stays on for a full lesson while recording; releases
      on stop.
- [ ] Page prev/next/rename work; per-page PNG export + board PDF export.

## Phase 2+ (sessions/semantic layer)

- [ ] Two lessons stored as two sessions; journal JSON exports typed objects.
- [ ] iPad lists past sessions and plays back its own recordings.
- [ ] Pencil double-tap & two-finger gestures don't fight the canvas
      (regression check each tldraw upgrade; upstream issues #10284/#10285).

## Results log

| Date | Result | Notes |
|---|---|---|
| 2026-09 | Merge + automated verification passed | Real-hardware rows above not yet executed |
