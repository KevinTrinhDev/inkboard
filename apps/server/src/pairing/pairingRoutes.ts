import type { FastifyInstance } from "fastify";
import { consumePairingNonce } from "./tokens.js";

export async function pairingRoutes(app: FastifyInstance) {
  app.post(
    "/api/pair",
    {
      config: {
        rateLimit: {
          // A few genuine scan attempts per minute is plenty; this is the
          // only real defense against brute-forcing the pairing token.
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { token?: string } | undefined;
      if (!body?.token || !consumePairingNonce(body.token)) {
        return reply.code(401).send({ error: "invalid, expired, or already-used pairing token" });
      }
      // The scanned token itself becomes the session credential for M0.
      // A real session/credential exchange is a design target for M4.
      return reply.send({ paired: true, credential: body.token });
    },
  );
}
