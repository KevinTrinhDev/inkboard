import type { FastifyInstance } from "fastify";
import { getBoardJsonSchema } from "@inkboard/shared-schema";

/**
 * Serves the same JSON Schema the client validates against, generated from
 * packages/shared-schema: proves client and server share one schema
 * artifact rather than two hand-maintained copies. See docs/API.md.
 */
export async function registerSchemaRoute(app: FastifyInstance) {
  app.get("/api/schema", async () => getBoardJsonSchema());
}
