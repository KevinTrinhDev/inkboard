import { zodToJsonSchema } from "zod-to-json-schema";
import { BoardObjectSchema } from "./objects/index.js";
import { JournalEventSchema } from "./events/index.js";

/**
 * The single JSON Schema document served at `GET /api/schema` (apps/server)
 * and consumed by anything that wants to validate or generate board objects
 * without importing TypeScript directly, including a future AI agent.
 */
export function getBoardJsonSchema() {
  return {
    boardObject: zodToJsonSchema(BoardObjectSchema, "BoardObject"),
    journalEvent: zodToJsonSchema(JournalEventSchema, "JournalEvent"),
  };
}
