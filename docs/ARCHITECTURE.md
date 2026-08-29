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

## Two-device setup

inkboard runs on two devices at once, with a deliberate split of jobs.

| | iPad | Laptop |
|---|---|---|
| Opens | `/` | `/mirror` |
| Sync role | `editor` | `mirror` (read-only) |
| Camera and mic | none requested | owns them |
| Can draw | yes | no |

The iPad is the drawing surface and nothing else. It is never prompted for
camera access, because it has no use for it and a denied prompt would leave
an error state on a device that was never going to record.

The laptop already has a camera and a microphone, so it does the capturing
and shows the board live while it records. Its view is read-only, enforced on
the server rather than merely hidden in the UI: a `mirror` connection that
sends a board mutation is refused. That means a buggy or tampered-with laptop
cannot corrupt the board the iPad is actively drawing on.

### How the board actually moves

The server holds the authoritative board, rather than blindly relaying frames
between peers. That single decision is what makes a device joining late, or
reconnecting after the iPad slept, receive the current canvas instead of a
blank one.

```
iPad (editor)                 server                    laptop (mirror)
  |                             |                             |
  |-- hello {role, token} ----->|                             |
  |<-- welcome {records} -------|                             |
  |                             |<---- hello {role, token} ---|
  |                             |----- welcome {records} ---->|
  |                             |                             |
  |-- diff (coalesced 50ms) --->|                             |
  |                        apply to board                     |
  |                             |------------ diff ---------->|
```

Local changes are subscribed with `{ source: "user", scope: "document" }`.
This matters: tldraw's `store.listen` defaults to `source: "all"`, so an
unfiltered listener would send every diff it had just applied from the server
straight back to it, forever. Incoming diffs are applied inside
`store.mergeRemoteChanges` for the same reason.

Diffs are coalesced over 50ms before sending, because a single pen stroke
emits a change per point and one frame per point would swamp the socket. The
coalescing preserves intent rather than just concatenating: a record created
and destroyed inside one window cancels out instead of being sent as an
addition the server would then have to remove.

Board records cross the wire opaquely, validated only as "an object with a
string id". The relay moves and stores board state without understanding
tldraw's schema, so a tldraw upgrade that changes record internals cannot
break the server, and the same relay would carry a different canvas library
later. tldraw's serialized schema rides alongside the records so a saved
board stays migratable.

The board is persisted to a single JSON file with debounced, write-then-rename
saves. A crash mid-write leaves the previous good file rather than a truncated
one, and a corrupt or missing file is non-fatal: starting empty beats refusing
to boot.

### Pasted images

tldraw's default asset store inlines files as base64 data URLs. That is fine
on one device and wrong on two: the data URL would bloat every board diff by
the whole file, and the record would still only render on the device where it
was pasted. Assets are instead uploaded once to the server and referenced by
a short same-origin URL, which is what makes "paste on the laptop, see it on
the iPad" work.

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
