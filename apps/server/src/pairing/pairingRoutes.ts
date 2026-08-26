import type { FastifyInstance } from "fastify";
import { consumePairingNonce, generateSessionCredential } from "./tokens.js";

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
      // Issue a separate, long-lived credential rather than handing back the
      // 5-minute pairing token itself: that TTL was fine for "scan the QR"
      // but far too short to survive an offline recording session.
      return reply.send({ paired: true, credential: generateSessionCredential() });
    },
  );
}
