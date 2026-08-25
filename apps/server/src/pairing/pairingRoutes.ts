import type { FastifyInstance } from "fastify";
import { verifyPairingToken } from "./tokens.js";

export async function pairingRoutes(app: FastifyInstance) {
  app.post("/api/pair", async (request, reply) => {
    const body = request.body as { token?: string } | undefined;
    if (!body?.token || !verifyPairingToken(body.token)) {
      return reply.code(401).send({ error: "invalid or expired pairing token" });
    }
    // The scanned token itself becomes the session credential for M0.
    // A real session/credential exchange is a design target for M4.
    return reply.send({ paired: true, credential: body.token });
  });
}
