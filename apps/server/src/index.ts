import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { pairingRoutes } from "./pairing/pairingRoutes.js";
import { printPairingQr } from "./pairing/printQr.js";
import { registerSignalingStub } from "./ws/signalingStub.js";
import { registerUploadRoute } from "./recording/uploadRoute.js";
import { registerSchemaRoute } from "./http/schemaRoute.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SERVER_PORT ?? 8080);
const domain = process.env.CADDY_DOMAIN ?? "inkboard.local";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, {
    root: join(__dirname, "../../client/dist"),
    // Fastify's ready check fails loudly if the client hasn't been built
    // yet; that's intentional feedback during setup, not a bug.
  });

  await app.register(pairingRoutes);
  await registerSignalingStub(app);
  await registerUploadRoute(app);
  await registerSchemaRoute(app);

  app.get("/healthz", async () => ({ ok: true }));

  await app.listen({ port, host: "0.0.0.0" });

  printPairingQr(`https://${domain}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
