# Roadmap

This is the sequential build plan. For cross-cutting improvements (performance, security,
UI/UX, additional use cases) layered on top of these milestones, see
[BACKLOG.md](./BACKLOG.md).

## M0: Scaffold + proof of concept (this pass)
- Repo structure, docs, CI/security baseline (gitleaks, pre-commit, dependency audit).
- Secure LAN HTTPS from the XPS reaches the iPad as an installable PWA (Caddy
  local CA + device-pairing QR gate).
- `tldraw` canvas with stub `Text`/`Math`/`Arrow`/`Shape` custom types; ink via
  tldraw's native `draw` shape proves Apple Pencil latency is acceptable.
- Camera/mic preview + `MediaRecorder` capture with upload-on-stop.
- `packages/shared-schema` exists and is consumed by both client and a stub
  `GET /api/schema` endpoint.

**Done when:** the verification steps in the plan/PR all pass on the actual
iPad + XPS hardware, not just `localhost`.

## M0.5: Two-device board (done)

- Real board sync over `/ws`, replacing the M0 signaling stub that only logged
  what it received. Server-authoritative board, persisted across restarts.
- The laptop opens `/mirror` for a read-only live view and owns the camera and
  mic; the iPad is the drawing surface. See ARCHITECTURE.md "Two-device setup".
- Pasted images upload to the server and sync as URLs, so an image dropped on
  one device appears on the other.
- Pairing supports several simultaneous devices. The previous
  single-active-session rule made the two-device setup impossible: pairing the
  laptop silently revoked the iPad.

**Done when:** a stroke on the iPad appears on the laptop mirror, a pasted
image crosses in the other direction, and both survive a sleep, a reconnect
and a server restart. Verified against the running server; still needs a pass
on real iPad hardware.

## M1: Live recording pipeline
- Replace `MediaRecorder`-upload with real WebRTC P2P so camera and mic are
  captured live, synchronized with the journal timeline. Note the capture now
  happens on the laptop, not the iPad, so this is a same-machine pipeline
  rather than a cross-device one.
- Persist the journal to disk per session; store camera/mic as their original
  tracks, untouched, alongside it.
- A first compositing/render pass: vector board + facecam → an MP4 master.

**Done when:** a full recorded session can be re-rendered to video without
re-recording anything.

## M2: Voice-to-board-text
- Wire up the `faster-whisper` sidecar (long-lived, CUDA-warm, localhost-only).
- "Tap the text tool, speak a phrase" shortcut inserts a `TEXT` object at the
  tapped position; correctable before committing.

**Done when:** the round trip (tap → speak → text appears) feels fast enough
to use live while teaching, not just as a batch/offline feature.

## M3: Translation / localization
- Translate `TEXT`/`MATH` `content` fields into additional languages, keeping
  `x`/`y` positions, and re-render a localized board per ARCHITECTURE.md's
  localization model.
- Pair with translated audio dubs per language.

**Done when:** one recorded session can produce more than one language's
finished video without touching the original recording.

## M4: Real AI-agent API
- Implement the "design target" surface in [API.md](./API.md) for real:
  `POST /api/sessions/:id/objects`, journal resync endpoint, WS event stream.
- Define auth for agent callers (distinct from the human device-pairing model
  in SECURITY.md).

**Done when:** an external process (not the iPad client) can drive a session
end-to-end using only the documented API.

## M5: Custom handwriting font polish
- Wire up Playpen Sans (variable font, 7 alternates/glyph + shuffler) for
  `TEXT` rendering, with a deterministic per-object random seed
  (`hash(sessionId + objectId)`) so re-renders are reproducible.
- Small, controlled "irregularity" layer on top (subtle baseline/rotation/
  spacing variation): 90% of the imperfection should come from the font's
  own alternates, not from added randomness.
- Optional: a bespoke signature handwriting font later, via FontForge.
