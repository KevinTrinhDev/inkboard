import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { pairingRoutes } from "./pairing/pairingRoutes.js";
import { registerBoardSync } from "./ws/boardSync.js";
import { BoardState, defaultBoardStatePath } from "./ws/boardState.js";
import { registerUploadRoute } from "./recording/uploadRoute.js";
import { registerSchemaRoute } from "./http/schemaRoute.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Prefixes that must keep answering with a real 404 instead of the SPA shell. */
const API_PREFIXES = ["/api/", "/ws", "/healthz"];

/** The path portion of a request URL, with any query string removed. */
function pathOf(url: string): string {
  const [path] = url.split("?");
  return path ?? url;
}

function isApiPath(url: string): boolean {
  const path = pathOf(url);
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

export interface BuildAppOptions {
  /**
   * Directory holding the built client. Defaults to the real apps/client/dist.
   * Tests override it with a fixture so they do not depend on `pnpm build`
   * having run first: CI runs `pnpm test` before `pnpm build`, so a test that
   * needs the real bundle passes locally and fails in CI.
   */
  clientDist?: string;
  /** Where the authoritative board is persisted. Overridden in tests. */
  boardStatePath?: string;
}

/**
 * Builds the fully configured server without listening, so tests can drive it
 * through app.inject() instead of binding a port.
 */
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const clientDist = options.clientDist ?? join(__dirname, "../../client/dist");
  const boardStatePath =
    options.boardStatePath ??
    defaultBoardStatePath(process.env.RECORDINGS_DIR ?? "./apps/server/recordings");
  const app = Fastify({
    logger: {
      serializers: {
        // Log the path, never the query string. The socket credential now
        // travels in the hello frame rather than ?token=, but pairing links
        // still carry a token in the URL, and Fastify's default serializer
        // would write it to the log in cleartext.
        req(request: FastifyRequest) {
          return {
            method: request.method,
            url: pathOf(request.url),
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
  });

  // Global default is generous: this is a LAN personal server, not a public
  // API. The meaningful limit is the tighter per-route one on /api/pair.
  await app.register(fastifyRateLimit, { max: 200, timeWindow: "1 minute" });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // tldraw and KaTeX both set inline element styles at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        // wss: only: the app is always served over HTTPS via Caddy, so a
        // plain ws: connection should never be attempted or allowed.
        connectSrc: ["'self'", "wss:"],
      },
    },
  });

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, { root: clientDist });

  await app.register(pairingRoutes);
  const board = new BoardState(boardStatePath);
  board.load();
  await registerBoardSync(app, board);
  await registerUploadRoute(app);
  await registerSchemaRoute(app);

  app.get("/healthz", async () => ({ ok: true }));

  // The startup QR encodes /pair?token=..., but the client is a single-page
  // app served as static files, so no /pair file exists on disk and Fastify
  // answered the QR's own URL with a 404, breaking pairing end to end.
  // Serve the SPA shell for non-API GETs instead. PairingGate reads ?token=
  // from window.location.search, which this rewrite preserves.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" || isApiPath(request.url)) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Route ${request.method}:${pathOf(request.url)} not found`,
        statusCode: 404,
      });
    }
    // Starting the server without building the client is a common setup
    // mistake, and a bare 404 on every page is a confusing way to discover
    // it. Say what is actually wrong.
    if (!existsSync(join(clientDist, "index.html"))) {
      return reply.code(503).send({
        error: "Service Unavailable",
        message: `Client bundle not found at ${clientDist}. Run \`pnpm build\` first.`,
        statusCode: 503,
      });
    }

    return reply.sendFile("index.html");
  });

  return app;
}
