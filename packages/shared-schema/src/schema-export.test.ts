import { describe, expect, it } from "vitest";
import { getBoardJsonSchema } from "./schema-export.js";

// This is what GET /api/schema actually serves. A regression here would
// silently break any external caller (including a future AI agent) relying
// on it to validate/generate board objects without importing TypeScript.
describe("getBoardJsonSchema", () => {
  it("returns a JSON Schema document for both boardObject and journalEvent", () => {
    const schema = getBoardJsonSchema();
    expect(schema).toHaveProperty("boardObject");
    expect(schema).toHaveProperty("journalEvent");
  });

  it("produces plain JSON-serializable output (no functions/undefined survive a round trip)", () => {
    const schema = getBoardJsonSchema();
    const roundTripped = JSON.parse(JSON.stringify(schema));
    expect(roundTripped).toEqual(schema);
  });
});
