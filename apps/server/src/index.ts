// Must stay first: loads the repo-root .env before anything reads process.env.
import "./env.js";
import { buildApp } from "./app.js";
import { printPairingQr } from "./pairing/printQr.js";

const port = Number(process.env.SERVER_PORT ?? 8080);
const domain = process.env.CADDY_DOMAIN ?? "inkboard.local";

async function main() {
  const app = await buildApp();

  // 127.0.0.1 only: Caddy (reverse_proxy 127.0.0.1:{port}) is the sole
  // intended entry point. Binding this to 0.0.0.0 would let anyone on the
  // LAN reach the API directly over plain HTTP, bypassing TLS entirely and
  // defeating the whole point of the Caddy local-CA setup. See
  // docs/SECURITY.md "Transport".
  await app.listen({ port, host: "127.0.0.1" });

  printPairingQr(`https://${domain}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
