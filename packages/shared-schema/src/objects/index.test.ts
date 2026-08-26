import { describe, expect, it } from "vitest";
import { BoardObjectSchema } from "./index.js";

const base = {
  id: "3b7f7c2a-6c4e-4a4a-9e9c-0f1a2b3c4d5e",
  x: 0.5,
  y: 0.5,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("BoardObjectSchema: text", () => {
  it("accepts a valid text object", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "text",
      content: "Newton's Second Law",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    const result = BoardObjectSchema.safeParse({ ...base, type: "text", content: "" });
    expect(result.success).toBe(false);
  });

  it("defaults lang, size, and style when omitted", () => {
    const result = BoardObjectSchema.safeParse({ ...base, type: "text", content: "hi" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "text") {
      expect(result.data.lang).toBe("en");
      expect(result.data.size).toBe(24);
      expect(result.data.style).toBe("classroom");
    }
  });
});

describe("BoardObjectSchema: math", () => {
  it("accepts a valid math object", () => {
    const result = BoardObjectSchema.safeParse({ ...base, type: "math", latex: "F = ma" });
    expect(result.success).toBe(true);
  });

  it("rejects empty latex", () => {
    const result = BoardObjectSchema.safeParse({ ...base, type: "math", latex: "" });
    expect(result.success).toBe(false);
  });
});

describe("BoardObjectSchema: ink", () => {
  it("accepts a valid ink stroke with at least one point", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "ink",
      points: [{ x: 0.1, y: 0.1, pressure: 0.5 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty points array", () => {
    const result = BoardObjectSchema.safeParse({ ...base, type: "ink", points: [] });
    expect(result.success).toBe(false);
  });

  it("rejects pressure outside 0-1", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "ink",
      points: [{ x: 0.1, y: 0.1, pressure: 1.5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("BoardObjectSchema: arrow", () => {
  it("accepts an arrow with at least two points", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "arrow",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an arrow with fewer than two points", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "arrow",
      points: [{ x: 0.1, y: 0.1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("BoardObjectSchema: shape", () => {
  it("accepts a valid rect shape", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "shape",
      kind: "rect",
      x2: 0.8,
      y2: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown shape kind", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "shape",
      kind: "triangle",
      x2: 0.8,
      y2: 0.8,
    });
    expect(result.success).toBe(false);
  });
});

describe("BoardObjectSchema: cross-cutting invariants", () => {
  it("rejects an unrecognized discriminant type", () => {
    const result = BoardObjectSchema.safeParse({ ...base, type: "video", content: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects coordinates outside the normalized 0-1 range", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      type: "text",
      content: "hi",
      x: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID id", () => {
    const result = BoardObjectSchema.safeParse({
      ...base,
      id: "not-a-uuid",
      type: "text",
      content: "hi",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing createdAt", () => {
    const withoutCreatedAt = { id: base.id, x: base.x, y: base.y };
    const result = BoardObjectSchema.safeParse({
      ...withoutCreatedAt,
      type: "text",
      content: "hi",
    });
    expect(result.success).toBe(false);
  });
});
