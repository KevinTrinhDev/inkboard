/**
 * Stress and edge-case pass against the running inkboard server.
 * Exits non-zero on the first failure. Never prints credentials.
 */
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const WS = "ws://127.0.0.1:8080/ws";
const V = 1;
const LOG = process.argv[2];

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function expect(condition, passMessage, failMessage) {
  if (condition) ok(passMessage);
  else bad(failMessage);
}

async function waitFor(fn, label, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(25);
  }
  bad(`timed out waiting for ${label}`);
  return false;
}

async function credential() {
  const log = readFileSync(LOG, "utf8");
  const m = log.match(/\/pair\?token=([^\s)]+)/);
  if (!m) throw new Error("no pairing token in log");
  const res = await fetch(`${BASE}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: decodeURIComponent(m[1]) }),
  });
  if (!res.ok) throw new Error(`pair failed HTTP ${res.status}`);
  return (await res.json()).credential;
}

function open(cred, role) {
  const ws = new WebSocket(WS);
  const state = { ws, seen: [], board: {}, closed: false, closeCode: null };
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data));
    state.seen.push(msg);
    if (msg.type === "welcome") state.board = { ...msg.records };
    if (msg.type === "diff") {
      for (const [id, r] of Object.entries(msg.diff.added ?? {})) state.board[id] = r;
      for (const [id, p] of Object.entries(msg.diff.updated ?? {})) state.board[id] = p[1];
      for (const id of Object.keys(msg.diff.removed ?? {})) delete state.board[id];
    }
  });
  ws.addEventListener("close", (e) => {
    state.closed = true;
    state.closeCode = e.code;
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("open", () => {
      if (role) ws.send(JSON.stringify({ v: V, type: "hello", role, token: cred }));
      resolve(state);
    });
  });
}

const cred = await credential();

console.log("\n[1] Throughput: 2000 rapid diffs from the editor");
{
  const ed = await open(cred, "editor");
  const mi = await open(cred, "mirror");
  await waitFor(() => ed.seen.some((m) => m.type === "welcome"), "editor welcome");
  await waitFor(() => mi.seen.some((m) => m.type === "welcome"), "mirror welcome");

  const N = 2000;
  const t0 = Date.now();
  for (let i = 0; i < N; i += 1) {
    ed.ws.send(
      JSON.stringify({
        v: V,
        type: "diff",
        diff: { added: { [`shape:t${i}`]: { id: `shape:t${i}`, typeName: "draw", i } }, updated: {}, removed: {} },
      }),
    );
  }
  const got = await waitFor(() => Object.keys(mi.board).length >= N, `${N} records on mirror`, 20000);
  const ms = Date.now() - t0;
  if (got) ok(`${N} diffs relayed in ${ms}ms (${Math.round(N / (ms / 1000))}/s), no loss`);
  ed.ws.close();
  mi.ws.close();
}

console.log("\n[2] Fan-out: 1 editor, 8 mirrors, all must converge");
{
  const ed = await open(cred, "editor");
  await waitFor(() => ed.seen.some((m) => m.type === "welcome"), "editor welcome");
  const mirrors = [];
  for (let i = 0; i < 8; i += 1) mirrors.push(await open(cred, "mirror"));
  await waitFor(() => mirrors.every((m) => m.seen.some((x) => x.type === "welcome")), "8 welcomes");

  ed.ws.send(
    JSON.stringify({
      v: V,
      type: "diff",
      diff: { added: { "shape:fan": { id: "shape:fan", typeName: "draw" } }, updated: {}, removed: {} },
    }),
  );
  const got = await waitFor(() => mirrors.every((m) => m.board["shape:fan"]), "all 8 mirrors updated");
  if (got) ok("all 8 mirrors received the stroke");
  ed.ws.close();
  mirrors.forEach((m) => m.ws.close());
}

console.log("\n[3] Reconnect storm: 40 connect/disconnect cycles");
{
  for (let i = 0; i < 40; i += 1) {
    const c = await open(cred, "mirror");
    c.ws.close();
  }
  const probe = await open(cred, "editor");
  const got = await waitFor(() => probe.seen.some((m) => m.type === "welcome"), "server still serving");
  if (got) ok("server healthy after 40 rapid reconnects");
  probe.ws.close();
}

console.log("\n[4] Oversized frame (>8MB) is rejected, not OOM");
{
  const c = await open(cred, "editor");
  await waitFor(() => c.seen.some((m) => m.type === "welcome"), "welcome");
  const huge = "x".repeat(9 * 1024 * 1024);
  c.ws.send(JSON.stringify({ v: V, type: "snapshot", records: { "a": { id: "a", blob: huge } } }));
  const got = await waitFor(() => c.closed || c.seen.some((m) => m.type === "error" && m.code === "too-large"), "rejection");
  if (got) ok(`oversized frame rejected (close ${c.closeCode ?? "n/a"}), server alive`);
  try {
    c.ws.close();
  } catch {
    // Already closed by the server, which is the expected outcome here.
  }
  const alive = await fetch(`${BASE}/healthz`);
  expect(
    alive.ok,
    "server still healthy after oversized frame",
    "server unhealthy after oversized frame",
  );
}

console.log("\n[5] Garbage frames do not kill the connection");
{
  const c = await open(cred, "editor");
  await waitFor(() => c.seen.some((m) => m.type === "welcome"), "welcome");
  for (const junk of ["", "null", "[]", "{}", '{"v":1}', "not json at all", '{"v":99,"type":"hello"}']) {
    c.ws.send(junk);
  }
  await sleep(300);
  c.ws.send(JSON.stringify({ v: V, type: "ping" }));
  const got = await waitFor(() => c.seen.some((m) => m.type === "pong"), "still responsive after garbage");
  if (got) ok("connection survived 7 malformed frames and still answers ping");
  c.ws.close();
}

console.log("\n[6] Unauthenticated socket is closed on the deadline path");
{
  const c = await open(cred, null);
  c.ws.send(JSON.stringify({ v: V, type: "ping" }));
  const got = await waitFor(
    () => c.seen.some((m) => m.type === "error" && m.code === "unauthenticated") || c.closed,
    "unauthenticated rejection",
  );
  if (got) ok("traffic before hello is refused");
  try {
    c.ws.close();
  } catch {
    // Already closed by the server, which is the expected outcome here.
  }
}

console.log("\n[7] Asset edge cases");
{
  const svg = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    headers: { "content-type": "image/svg+xml", authorization: `Bearer ${cred}` },
    body: "<svg onload=alert(1)></svg>",
  });
  expect(svg.status === 415, "SVG upload rejected (415)", `SVG got ${svg.status}`);

  const noAuth = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: "x",
  });
  expect(
    noAuth.status === 401,
    "unauthenticated asset upload rejected (401)",
    `unauthenticated asset upload got ${noAuth.status}`,
  );

  const trav = await fetch(`${BASE}/api/assets/..%2f..%2fetc%2fpasswd`);
  expect(
    [400, 404].includes(trav.status),
    `path traversal rejected (${trav.status})`,
    `traversal got ${trav.status}`,
  );

  const big = Buffer.alloc(51 * 1024 * 1024, 1);
  const over = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    headers: { "content-type": "image/png", authorization: `Bearer ${cred}` },
    body: big,
  });
  expect(
    [413, 502].includes(over.status),
    `oversized asset rejected (${over.status})`,
    `oversized asset got ${over.status}`,
  );
}

console.log("\n[8] Board survives: state persists across a late join after churn");
{
  const late = await open(cred, "mirror");
  const got = await waitFor(() => Object.keys(late.board).length > 1000, "late joiner gets big board");
  if (got) ok(`late joiner received ${Object.keys(late.board).length} records`);
  late.ws.close();
}

const health = await fetch(`${BASE}/healthz`);
expect(
  health.ok,
  "\nserver healthy at end of run",
  "\nserver unhealthy at end of run",
);

console.log(failures === 0 ? "\nSTRESS PASS: no failures" : `\nSTRESS FAIL: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
