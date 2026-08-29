import { describe, expect, it } from "vitest";
import {
  applyRecordsDiff,
  ClientMessageSchema,
  emptyRecordsDiff,
  isEmptyRecordsDiff,
  RecordsDiffSchema,
  ServerMessageSchema,
  squashRecordsDiff,
  SYNC_PROTOCOL_VERSION,
  type RecordsDiff,
  type SyncRecord,
} from "./protocol.js";

const V = SYNC_PROTOCOL_VERSION;

function rec(id: string, extra: Record<string, unknown> = {}): SyncRecord {
  return { id, ...extra };
}

describe("RecordsDiffSchema", () => {
  it("defaults every bucket so a partial diff is still usable", () => {
    const parsed = RecordsDiffSchema.parse({});
    expect(parsed).toEqual({ added: {}, updated: {}, removed: {} });
  });

  it("keeps unknown record fields, since records are opaque to the relay", () => {
    const parsed = RecordsDiffSchema.parse({
      added: { "shape:a": { id: "shape:a", typeName: "draw", x: 4 } },
    });
    expect(parsed.added["shape:a"]).toMatchObject({ typeName: "draw", x: 4 });
  });

  it("rejects a record with no id", () => {
    expect(RecordsDiffSchema.safeParse({ added: { a: { x: 1 } } }).success).toBe(false);
  });
});

describe("applyRecordsDiff", () => {
  it("adds, updates and removes in one pass", () => {
    const base: Record<string, SyncRecord> = { "a": rec("a", { v: 1 }), "b": rec("b") };
    const diff: RecordsDiff = {
      added: { c: rec("c") },
      updated: { a: [rec("a", { v: 1 }), rec("a", { v: 2 })] },
      removed: { b: rec("b") },
    };

    expect(applyRecordsDiff(base, diff)).toEqual({
      a: { id: "a", v: 2 },
      c: { id: "c" },
    });
  });

  it("does not mutate the input", () => {
    const base: Record<string, SyncRecord> = { a: rec("a") };
    applyRecordsDiff(base, { added: { b: rec("b") }, updated: {}, removed: {} });
    expect(base).toEqual({ a: { id: "a" } });
  });
});

describe("squashRecordsDiff", () => {
  it("lets the later update win", () => {
    const target = emptyRecordsDiff();
    squashRecordsDiff(target, {
      added: {},
      updated: { a: [rec("a", { v: 1 }), rec("a", { v: 2 })] },
      removed: {},
    });
    squashRecordsDiff(target, {
      added: {},
      updated: { a: [rec("a", { v: 2 }), rec("a", { v: 3 })] },
      removed: {},
    });

    // Endpoints are preserved: original "before", newest "after".
    expect(target.updated.a?.[0]).toMatchObject({ v: 1 });
    expect(target.updated.a?.[1]).toMatchObject({ v: 3 });
  });

  it("folds an update to an unsent addition back into the addition", () => {
    const target = emptyRecordsDiff();
    squashRecordsDiff(target, { added: { a: rec("a", { v: 1 }) }, updated: {}, removed: {} });
    squashRecordsDiff(target, {
      added: {},
      updated: { a: [rec("a", { v: 1 }), rec("a", { v: 9 })] },
      removed: {},
    });

    expect(target.added.a).toMatchObject({ v: 9 });
    // The server never saw the record, so an update would be meaningless.
    expect(target.updated.a).toBeUndefined();
  });

  it("cancels a record created and destroyed within one window", () => {
    const target = emptyRecordsDiff();
    squashRecordsDiff(target, { added: { a: rec("a") }, updated: {}, removed: {} });
    squashRecordsDiff(target, { added: {}, updated: {}, removed: { a: rec("a") } });

    expect(isEmptyRecordsDiff(target)).toBe(true);
  });

  it("keeps a removal of a record the server already knows about", () => {
    const target = emptyRecordsDiff();
    squashRecordsDiff(target, { added: {}, updated: {}, removed: { a: rec("a") } });

    expect(target.removed.a).toBeDefined();
    expect(isEmptyRecordsDiff(target)).toBe(false);
  });

  it("resurrects a record re-added after removal", () => {
    const target = emptyRecordsDiff();
    squashRecordsDiff(target, { added: {}, updated: {}, removed: { a: rec("a") } });
    squashRecordsDiff(target, { added: { a: rec("a", { v: 2 }) }, updated: {}, removed: {} });

    expect(target.removed.a).toBeUndefined();
    expect(target.added.a).toMatchObject({ v: 2 });
  });

  it("squashing then applying matches applying each diff in order", () => {
    const diffs: RecordsDiff[] = [
      { added: { a: rec("a", { v: 1 }), b: rec("b") }, updated: {}, removed: {} },
      { added: {}, updated: { a: [rec("a", { v: 1 }), rec("a", { v: 2 })] }, removed: {} },
      { added: { c: rec("c") }, updated: {}, removed: { b: rec("b") } },
    ];

    let sequential: Record<string, SyncRecord> = {};
    for (const diff of diffs) sequential = applyRecordsDiff(sequential, diff);

    const squashed = emptyRecordsDiff();
    for (const diff of diffs) squashRecordsDiff(squashed, diff);
    const batched = applyRecordsDiff({}, squashed);

    expect(batched).toEqual(sequential);
  });
});

describe("message envelopes", () => {
  it("accepts a well-formed hello", () => {
    const parsed = ClientMessageSchema.safeParse({
      v: V,
      type: "hello",
      role: "mirror",
      token: "session.abc.def",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a hello with no token, so an unauthenticated peer cannot join", () => {
    const parsed = ClientMessageSchema.safeParse({ v: V, type: "hello", role: "mirror" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const parsed = ClientMessageSchema.safeParse({
      v: V,
      type: "hello",
      role: "admin",
      token: "x",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a mismatched protocol version", () => {
    const parsed = ClientMessageSchema.safeParse({
      v: V + 1,
      type: "hello",
      role: "editor",
      token: "x",
    });
    expect(parsed.success).toBe(false);
  });

  it("round-trips a server welcome through JSON", () => {
    const message = {
      v: V,
      type: "welcome" as const,
      role: "editor" as const,
      records: { "shape:a": rec("shape:a") },
      peers: 2,
    };
    const parsed = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(message)));
    expect(parsed.success).toBe(true);
  });
});
