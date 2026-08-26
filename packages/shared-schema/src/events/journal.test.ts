import { describe, expect, it } from "vitest";
import { JournalEventSchema } from "./journal.js";

const valid = {
  sessionId: "3b7f7c2a-6c4e-4a4a-9e9c-0f1a2b3c4d5e",
  opId: 1,
  op: "CREATE" as const,
  objectId: "7c2a3b7f-4e6c-4a4a-9e9c-0f1a2b3c4d5e",
  at: "2026-01-01T00:00:00.000Z",
};

describe("JournalEventSchema", () => {
  it("accepts a minimal valid event with no payload", () => {
    expect(JournalEventSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an event with a payload patch", () => {
    const result = JournalEventSchema.safeParse({ ...valid, payload: { content: "hi" } });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown op", () => {
    const result = JournalEventSchema.safeParse({ ...valid, op: "REPLACE" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative opId — must be monotonic and positive", () => {
    expect(JournalEventSchema.safeParse({ ...valid, opId: 0 }).success).toBe(false);
    expect(JournalEventSchema.safeParse({ ...valid, opId: -1 }).success).toBe(false);
  });

  it("rejects a non-integer opId", () => {
    expect(JournalEventSchema.safeParse({ ...valid, opId: 1.5 }).success).toBe(false);
  });

  it("rejects a non-UUID sessionId or objectId", () => {
    expect(JournalEventSchema.safeParse({ ...valid, sessionId: "abc" }).success).toBe(false);
    expect(JournalEventSchema.safeParse({ ...valid, objectId: "abc" }).success).toBe(false);
  });

  it("rejects a malformed timestamp", () => {
    expect(JournalEventSchema.safeParse({ ...valid, at: "not-a-date" }).success).toBe(false);
  });
});
