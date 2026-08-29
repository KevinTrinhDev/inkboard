import { z } from "zod";

/**
 * Wire protocol for live board mirroring over the /ws socket.
 *
 * Design note: a board record is deliberately opaque here, validated only as
 * "an object with a string id". The relay's job is to move and store board
 * state, not to understand tldraw's internal record schema. Keeping it opaque
 * means a tldraw upgrade that changes record internals cannot break the
 * server, and the same relay would carry a different canvas library later.
 * The typed board contract that inkboard actually reasons about lives in
 * ../objects, and is produced at export time, not on the wire.
 */

/** Protocol version. Bumped only on a breaking envelope change. */
export const SYNC_PROTOCOL_VERSION = 1;

export const SyncRecordSchema = z.object({ id: z.string().min(1) }).passthrough();
export type SyncRecord = z.infer<typeof SyncRecordSchema>;

/**
 * Mirrors tldraw's RecordsDiff shape: `updated` carries [before, after] pairs.
 * Only `after` is applied, but the pair is preserved so the wire format stays
 * a faithful copy of what the editor emitted.
 */
export const RecordsDiffSchema = z.object({
  added: z.record(z.string(), SyncRecordSchema).default({}),
  updated: z
    .record(z.string(), z.tuple([SyncRecordSchema, SyncRecordSchema]))
    .default({}),
  removed: z.record(z.string(), SyncRecordSchema).default({}),
});
export type RecordsDiff = z.infer<typeof RecordsDiffSchema>;

/**
 * `editor` may mutate the board (the iPad). `mirror` is strictly read-only
 * (the laptop's live view) and the server rejects any diff it sends, so a
 * compromised or buggy mirror cannot corrupt the board.
 */
export const SyncRoleSchema = z.enum(["editor", "mirror"]);
export type SyncRole = z.infer<typeof SyncRoleSchema>;

const envelope = { v: z.literal(SYNC_PROTOCOL_VERSION) };

/**
 * First message on every socket. The session credential travels in the
 * message body rather than the URL query string on purpose: a query string
 * is logged by every intermediary, including Caddy's access log, so putting
 * a 30-day bearer credential there leaks it well beyond this application.
 */
export const ClientHelloSchema = z.object({
  ...envelope,
  type: z.literal("hello"),
  role: SyncRoleSchema,
  token: z.string().min(1),
});

export const ClientDiffSchema = z.object({
  ...envelope,
  type: z.literal("diff"),
  diff: RecordsDiffSchema,
});

/**
 * tldraw's serialized schema, carried opaquely alongside the records so a
 * board saved by one client version can still be migrated by another. The
 * relay never interprets it.
 */
export const SerializedSchemaSchema = z.record(z.string(), z.unknown());

/** Full-state push, used to seed a server that has no board yet. */
export const ClientSnapshotSchema = z.object({
  ...envelope,
  type: z.literal("snapshot"),
  records: z.record(z.string(), SyncRecordSchema),
  schema: SerializedSchemaSchema.optional(),
});

export const ClientPingSchema = z.object({
  ...envelope,
  type: z.literal("ping"),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  ClientDiffSchema,
  ClientSnapshotSchema,
  ClientPingSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerWelcomeSchema = z.object({
  ...envelope,
  type: z.literal("welcome"),
  role: SyncRoleSchema,
  records: z.record(z.string(), SyncRecordSchema),
  schema: SerializedSchemaSchema.optional(),
  peers: z.number().int().nonnegative(),
});

export const ServerDiffSchema = z.object({
  ...envelope,
  type: z.literal("diff"),
  diff: RecordsDiffSchema,
});

export const ServerPeersSchema = z.object({
  ...envelope,
  type: z.literal("peers"),
  peers: z.number().int().nonnegative(),
});

export const ServerPongSchema = z.object({
  ...envelope,
  type: z.literal("pong"),
});

export const ServerErrorSchema = z.object({
  ...envelope,
  type: z.literal("error"),
  code: z.enum([
    "bad-message",
    "not-an-editor",
    "too-large",
    "unsupported-version",
    "unauthenticated",
  ]),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerWelcomeSchema,
  ServerDiffSchema,
  ServerPeersSchema,
  ServerPongSchema,
  ServerErrorSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/**
 * Applies a diff to a plain record map, in the same order tldraw does:
 * additions and updates write, removals delete. Shared by the server (which
 * keeps the authoritative board so a late-joining device gets current state)
 * and by tests. Pure, so it is trivially testable.
 */
export function applyRecordsDiff(
  records: Record<string, SyncRecord>,
  diff: RecordsDiff,
): Record<string, SyncRecord> {
  const next = { ...records };

  for (const [id, record] of Object.entries(diff.added)) {
    next[id] = record;
  }
  for (const [id, pair] of Object.entries(diff.updated)) {
    // pair is [before, after]; only the resulting state matters.
    next[id] = pair[1];
  }
  for (const id of Object.keys(diff.removed)) {
    delete next[id];
  }

  return next;
}
