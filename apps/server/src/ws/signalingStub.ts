import type { FastifyInstance } from "fastify";
import { verifyPairingToken } from "../pairing/tokens.js";

/**
 * M0 stub: validates the pairing token on connect and logs messages.
 * Real SDP/ICE relay for live WebRTC capture is M1 — see docs/ROADMAP.md.
 */
export async function registerSignalingStub(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (socket, request) => {
    const url = new URL(request.url, "http://localhost");
    const token = url.searchParams.get("token") ?? "";

    if (!verifyPairingToken(token)) {
      socket.close(4401, "invalid or expired pairing token");
      return;
    }

    app.log.info("client connected to signaling stub");

    socket.on("message", (raw: Buffer) => {
      app.log.info({ msg: raw.toString() }, "signaling message received");
    });

    socket.on("close", () => {
      app.log.info("client disconnected from signaling stub");
    });
  });
}
