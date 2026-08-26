# Board schema & API

The types described here live in `packages/shared-schema` and are the single
source of truth: both the tldraw client and the server import from this
package, so the on-canvas representation and the persisted/replayable
representation can never drift apart. This is also the contract a future
AI agent would target (see [ROADMAP.md](./ROADMAP.md) M4); it's designed for
that from day one even though only a human draws on the board today.

## Board objects

Every object shares a common envelope:

```ts
interface BoardObjectBase {
  id: string;
  type: "text" | "math" | "ink" | "arrow" | "shape";
  x: number; // normalized 0.0–1.0, NOT pixels
  y: number; // normalized 0.0–1.0
  createdAt: string; // ISO 8601
}
```

- **TEXT**: `{ content: string; lang: string; size: number; style: string }`.
  Rendered via the handwriting-style font (Playpen Sans, M5). `lang` +
  `content` are what a translation pass regenerates: never touch pixels.
- **MATH**: `{ latex: string; size: number }`. Rendered via KaTeX, never the
  handwriting font: math legibility (`x` vs `2` vs `z`) matters more than
  stylistic consistency.
- **INK**: `{ points: { x: number; y: number; pressure: number }[] }`. Raw
  Pencil strokes; maps directly to tldraw's native `draw` shape.
- **ARROW**: `{ points: { x: number; y: number }[] }`.
- **SHAPE**: `{ kind: "rect" | "ellipse" | "line"; x2: number; y2: number }`,
  rendered with a hand-drawn/sketchy style.

## Journal (event log)

The board is never saved as one overwritten document. Every mutation is an
appended, monotonically-numbered event scoped to a session:

```ts
interface JournalEvent {
  sessionId: string;
  opId: number; // monotonic per session, starts at 1
  op: "CREATE" | "UPDATE" | "DELETE";
  objectId: string;
  payload?: Partial<BoardObjectBase> & Record<string, unknown>;
  at: string; // ISO 8601
}
```

**Resync model:** the client tracks `lastAckedOp`. If the connection drops, on
reconnect it asks the server for everything after that op ID
(`GET /api/sessions/:id/journal?fromOp=N`) instead of re-fetching the whole
board. This is why ops are monotonic integers, not just timestamps or UUIDs.

## HTTP surface

**Implemented today (M0):**

- `GET /api/schema`: returns the JSON Schema for the object/event types above,
  generated from `packages/shared-schema`. Exists to prove the pattern: the
  server's idea of the schema and the client's idea of the schema are the same
  artifact, not two hand-maintained copies.
- `POST /api/pair`: exchanges a scanned pairing token for a session
  credential (see [SECURITY.md](./SECURITY.md)).
- `POST /api/sessions/:id/upload`: accepts a `MediaRecorder` blob on
  recording stop (M0's stand-in for live capture; see ROADMAP M1).

**Design target, not yet implemented**: sketched here so the data model
doesn't need to change when these land:

- `POST /api/sessions/:id/objects`: create a board object programmatically.
  This is the primary surface an AI agent would use to "draw" on a board
  (e.g. narrate a lesson and place `TEXT`/`MATH`/`ARROW` objects as it talks).
- `GET /api/sessions/:id/journal?fromOp=N`: resync/replay the event log,
  described above.
- A WebSocket event stream mirroring the journal in real time, for a live
  collaborator (human or agent) watching a session.

## Localization

Because `TEXT`/`MATH` objects carry `lang` and their source content rather
than baked pixels, producing a Spanish or French version of a board means
generating new `TEXT` objects at the same normalized position with translated
`content`, not OCR, not video inpainting, not subtitle overlays. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the full rationale.
