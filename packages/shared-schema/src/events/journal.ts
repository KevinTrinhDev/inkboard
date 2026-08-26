import { z } from "zod";

/**
 * Append-only, per-session operation log. `opId` is a monotonic integer
 * (not a timestamp/UUID) specifically so a reconnecting client can resync by
 * asking for "everything after opId N" instead of re-fetching the whole
 * board. See docs/API.md.
 */
export const JournalEventSchema = z.object({
  sessionId: z.string().uuid(),
  opId: z.number().int().positive(),
  op: z.enum(["CREATE", "UPDATE", "DELETE"]),
  objectId: z.string().uuid(),
  // A partial patch against whichever BoardObject `objectId` refers to.
  // Not validated against the full discriminated union here (Zod doesn't
  // support .partial() on discriminated unions): each field is still
  // individually well-typed via BoardObjectBase's shape at the object level.
  payload: z.record(z.string(), z.unknown()).optional(),
  at: z.string().datetime(),
});

export type JournalEvent = z.infer<typeof JournalEventSchema>;
