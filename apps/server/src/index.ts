// Must stay first: loads the repo-root .env before anything reads process.env.
import "./env.js";
import { buildApp } from "./app.js";
import { printPairingInstructions } from "./pairing/printQr.js";
import { revokeAllSessions } from "./pairing/tokens.js";
import { defaultSessionStorePath, resolveRecordingsDir } from "./paths.js";

const port = Number(process.env.SERVER_PORT ?? 8080);
const domain = process.env.CADDY_DOMAIN ?? "inkboard.local";

async function main() {
  const sessionStorePath = defaultSessionStorePath(resolveRecordingsDir());
  const app = await buildApp({ sessionStorePath });

  // `--pair` forgets every paired device and prints a fresh QR. This is the
  // supported way to add or replace a device now that pairing persists
  // across restarts, and it replaces the old accidental behaviour where
  // every restart silently un-paired everything.
  if (process.argv.includes("--pair")) revokeAllSessions();

  // 127.0.0.1 only: Caddy (reverse_proxy 127.0.0.1:{port}) is the sole
  // intended entry point. Binding this to 0.0.0.0 would let anyone on the
  // LAN reach the API directly over plain HTTP, bypassing TLS entirely and
  // defeating the whole point of the Caddy local-CA setup. See
  // docs/SECURITY.md "Transport".
  await app.listen({ port, host: "127.0.0.1" });

  const baseUrl = `https://${domain}`;
  printPairingInstructions(baseUrl, `${baseUrl}/mirror`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
