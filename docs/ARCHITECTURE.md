# Architecture

## The core idea: the board is data, not video

The whiteboard never fundamentally contains pixels. It contains typed objects:

```
TEXT   "Newton's Second Law"   x=0.31 y=0.22  style=classroom  lang=en
MATH   latex: "F = ma"          x=0.42 y=0.34
INK    points: [...] pressure: [...]
ARROW  points: [...]
SHAPE  rect | ellipse | line, rough-rendered
```

A renderer turns those objects into pixels at export time, never the other way
around. This is the single decision the rest of the system exists to serve, and
it's why every choice below favors "store meaning" over "store an image."

What it buys us:
- **Resolution independence.** All coordinates are normalized `0.0–1.0`, not
  pixels, so the same board renders correctly at 1080p, 4K, vertical Shorts, or
  square social crops without rebuilding layout.
- **Re-skinning.** Swap the handwriting font/style later; every old session can
  be re-rendered with the new look.
- **Translation.** A `TEXT` object carries a `lang` field and the source
  content. Localizing a video means generating new `TEXT`/`MATH` objects in
  another language at the same board position and re-rendering, not OCR,
  not video inpainting.
- **Agent-friendliness.** Because the board is a documented object schema
  (`packages/shared-schema`), anything that can emit valid objects (a human
  drawing, or later an AI agent narrating a lesson) can drive the board. See
  [API.md](./API.md).

## System diagram

```
        Apple Pencil / touch
                │
                ▼
   ┌─────────────────────────┐
   │   iPad Safari (PWA)      │
   │                           │
   │  tldraw canvas            │
   │   → shape created         │
   │   → rendered LOCALLY,     │  <-- ink must appear before any network round trip
   │     instantly              │
   │   → journal event queued  │
   │                           │
   │  getUserMedia() preview   │
   │  MediaRecorder capture    │
   └────────────┬──────────────┘
                │  LAN only (Wi-Fi/Ethernet)
                │  HTTPS (Caddy local CA) + WSS
                ▼
   ┌─────────────────────────┐
   │   Ubuntu XPS              │
   │                           │
   │  Caddy (reverse proxy,    │
   │   local HTTPS)            │
   │        │                  │
   │  Fastify server            │
   │   - serves the PWA build  │
   │   - pairing (QR token)    │
   │   - WS signaling stub     │
   │   - upload-on-stop route  │
   │        │                  │
   │  faster-whisper sidecar   │  (M2, not wired yet)
   │   (long-lived, CUDA-warm) │
   └─────────────────────────┘
```

## Decisions and why

### Canvas engine: tldraw SDK, not a custom engine
tldraw already solves pressure-sensitive freehand drawing, panning/zooming, and
extensible custom shape/tool types to a level of polish that would take a long
time to match from scratch (e.g. hand-rolled `perfect-freehand` + `Rough.js` +
manual tiling). We extend it with custom shape types (`TextShapeUtil`,
`MathShapeUtil`, etc.) rather than replacing its core. Ink strokes use tldraw's
native `draw` shape directly: that's the thing that has to feel instant under
an Apple Pencil, so we don't add any custom logic in that path.

### AV transport: plain WebRTC P2P, not an SFU
This system is always exactly one iPad talking to exactly one server on a home
LAN, actively enforced (not just conventional) since pairing a new device
revokes the previous one's credential server-side, see docs/SECURITY.md
"Device pairing." An SFU (LiveKit, mediasoup) exists to route media between
many participants: added infrastructure (signaling servers, media routing,
often Redis/Postgres) that buys nothing here and is more attack surface to
secure.
A small custom WebSocket signaling server plus direct WebRTC P2P is the right
amount of machinery for 1:1. If this ever needs multiple simultaneous
viewers, mediasoup is the documented fallback (see ROADMAP M1+).

For the first milestone (M0, this scaffold) even WebRTC is deferred: the PWA
uses `MediaRecorder` to capture locally and uploads the file when recording
stops. This proves camera/mic permissions and the upload path work without
first building real-time transport. Live WebRTC capture is M1.

### Transport security: local HTTPS + LAN firewall + device pairing
Browser media APIs (`getUserMedia`) require a secure context: plain
`http://192.168.x.x` won't work. Caddy's built-in local CA (`tls internal`)
solves this without needing a public domain or Let's Encrypt. The iPad trusts
that CA once (a Configuration Profile install + enabling full trust). On top
of that, UFW restricts inbound traffic to the LAN subnet only. Nothing is
ever exposed to the internet, and a one-time QR device-pairing step is the
actual authentication gate, because "on the same Wi-Fi" is not, by itself,
sufficient authorization. Full detail in [SECURITY.md](./SECURITY.md).

### Transcription: faster-whisper with CUDA
The XPS has an NVIDIA GPU (RTX 3050 Ti Laptop), and faster-whisper's CTranslate2
CUDA backend outperforms whisper.cpp on NVIDIA hardware. It runs as a
long-lived local HTTP sidecar (127.0.0.1-only) so the model stays warm in GPU
memory between "tap text tool, speak a phrase" invocations: the whole point
of the shortcut is that it has to feel fast.

### Text rendering: Playpen Sans, not real handwriting recognition
Playpen Sans (OFL-licensed, TypeTogether) ships seven alternate glyph forms
per character plus a built-in OpenType shuffler that avoids repeating the same
glyph shape nearby, specifically designed to avoid the "obviously a font"
look real handwriting fonts usually have. Font wiring is deferred to M5; the
`TEXT` shape type and its normalized-coordinate storage exist from M0 so
nothing about the data model has to change when the font lands.

### Math rendering: KaTeX, never font glyphs
Equations are stored as LaTeX strings and rendered with KaTeX, never typed in
the handwriting font. This keeps ambiguous characters (`x`/`2`/`z`) legible,
which matters more for math than stylistic consistency does.

### Data model: append-only journal, normalized coordinates
Every board mutation is a numbered event (`CREATE`/`UPDATE`/`DELETE`) in a
per-session journal, not a single overwritten "whiteboard file." If Wi-Fi
drops mid-session, the client resumes by asking the server for events after
its last-acknowledged operation ID, instead of re-syncing an entire document.
See [API.md](./API.md) for the exact schema.
