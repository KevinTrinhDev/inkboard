/**
 * Live two-device check against the running server.
 * Pairs via the real POST /api/pair handshake, then opens an "iPad" editor
 * socket and a "laptop" mirror socket and proves a drawing crosses over.
 * Never prints the credential.
 */
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const LOG = process.argv[2];
const V = 1;

function pairingTokenFromLog() {
  const log = readFileSync(LOG, "utf8");
  const match = log.match(/\/pair\?token=([^\s)]+)/);
  if (!match) throw new Error("no pairing token in the server log");
  return decodeURIComponent(match[1]);
}

async function credential() {
  const res = await fetch(`${BASE}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: pairingTokenFromLog() }),
  });
  if (!res.ok) throw new Error(`pairing failed: HTTP ${res.status}`);
  const { credential } = await res.json();
  return credential;
}

function open(cred, role) {
  const ws = new WebSocket("ws://127.0.0.1:8080/ws");
  const seen = [];
  const board = {};
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    seen.push(m);
    if (m.type === "welcome") Object.assign(board, m.records);
    if (m.type === "diff") {
      for (const [id, r] of Object.entries(m.diff.added ?? {})) board[id] = r;
      for (const [id, p] of Object.entries(m.diff.updated ?? {})) board[id] = p[1];
      for (const id of Object.keys(m.diff.removed ?? {})) delete board[id];
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("error", () => reject(new Error("socket error")));
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ v: V, type: "hello", role, token: cred }));
      resolve({ ws, seen, board });
    });
  });
}

const waitFor = async (fn, label) => {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const cred = await credential();
console.log("paired via POST /api/pair: OK");

const ipad = await open(cred, "editor");
const laptop = await open(cred, "mirror");
await waitFor(
  () => ipad.seen.some((m) => m.type === "welcome") && laptop.seen.some((m) => m.type === "welcome"),
  "both welcomes",
);
console.log("iPad (editor) and laptop (mirror) both connected: OK");

ipad.ws.send(
  JSON.stringify({
    v: V,
    type: "diff",
    diff: {
      added: { "shape:live": { id: "shape:live", typeName: "draw", note: "hello" } },
      updated: {},
      removed: {},
    },
  }),
);
await waitFor(() => laptop.board["shape:live"], "stroke to reach the laptop");
console.log("stroke drawn on iPad appeared on laptop mirror: OK");

// A mirror must not be able to write.
laptop.ws.send(
  JSON.stringify({
    v: V,
    type: "diff",
    diff: { added: { "shape:evil": { id: "shape:evil" } }, updated: {}, removed: {} },
  }),
);
await waitFor(
  () => laptop.seen.some((m) => m.type === "error" && m.code === "not-an-editor"),
  "mirror write rejection",
);
console.log("laptop mirror was refused write access: OK");

// Asset round trip: a 1x1 PNG uploaded, then fetched back.
const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000a49444154789c6300010000050001",
  "hex",
);
const up = await fetch(`${BASE}/api/assets`, {
  method: "POST",
  headers: { "content-type": "image/png", authorization: `Bearer ${cred}` },
  body: png,
});
if (up.status !== 201) throw new Error(`asset upload: HTTP ${up.status}`);
const { src } = await up.json();
const back = await fetch(`${BASE}${src}`);
const bytes = Buffer.from(await back.arrayBuffer());
if (!bytes.equals(png)) throw new Error("asset bytes did not round-trip");
console.log(`asset uploaded and fetched back byte-identical from ${src}: OK`);

// A late joiner must receive the accumulated board.
const late = await open(cred, "mirror");
await waitFor(() => late.board["shape:live"], "late joiner to receive the board");
console.log("late-joining device received the existing board: OK");

ipad.ws.close();
laptop.ws.close();
late.ws.close();
console.log("\nALL LIVE CHECKS PASSED");
