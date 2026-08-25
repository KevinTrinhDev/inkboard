# Roadmap

## M0 — Scaffold + proof of concept (this pass)
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

## M1 — Live recording pipeline
- Replace `MediaRecorder`-upload with real WebRTC P2P (iPad ↔ XPS) so camera
  and mic are captured live, synchronized with the journal timeline.
- Persist the journal to disk per session; store camera/mic as their original
  tracks, untouched, alongside it.
- A first compositing/render pass: vector board + facecam → an MP4 master.

**Done when:** a full recorded session can be re-rendered to video without
re-recording anything.

## M2 — Voice-to-board-text
- Wire up the `faster-whisper` sidecar (long-lived, CUDA-warm, localhost-only).
- "Tap the text tool, speak a phrase" shortcut inserts a `TEXT` object at the
  tapped position; correctable before committing.

**Done when:** the round trip (tap → speak → text appears) feels fast enough
to use live while teaching, not just as a batch/offline feature.

## M3 — Translation / localization
- Translate `TEXT`/`MATH` `content` fields into additional languages, keeping
  `x`/`y` positions, and re-render a localized board per ARCHITECTURE.md's
  localization model.
- Pair with translated audio dubs per language.

**Done when:** one recorded session can produce more than one language's
finished video without touching the original recording.

## M4 — Real AI-agent API
- Implement the "design target" surface in [API.md](./API.md) for real:
  `POST /api/sessions/:id/objects`, journal resync endpoint, WS event stream.
- Define auth for agent callers (distinct from the human device-pairing model
  in SECURITY.md).

**Done when:** an external process (not the iPad client) can drive a session
end-to-end using only the documented API.

## M5 — Custom handwriting font polish
- Wire up Playpen Sans (variable font, 7 alternates/glyph + shuffler) for
  `TEXT` rendering, with a deterministic per-object random seed
  (`hash(sessionId + objectId)`) so re-renders are reproducible.
- Small, controlled "irregularity" layer on top (subtle baseline/rotation/
  spacing variation) — 90% of the imperfection should come from the font's
  own alternates, not from added randomness.
- Optional: a bespoke signature handwriting font later, via FontForge.
