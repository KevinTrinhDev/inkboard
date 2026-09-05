/**
 * Captures the README screenshots from a running inkboard server.
 *
 * Usage: node scripts/screenshots.mjs [base-url] [ipad-link-file] [laptop-link-file]
 *
 * Pairing links default to /tmp/inkboard-ipad-link.txt and
 * /tmp/inkboard-laptop-link.txt (written next to the server log by
 * infra/scripts/dev-up.sh --pair).
 *
 * Board content is authored through window.__inkboard.editor (the same
 * tldraw records the tools create) so the shots are deterministic; the
 * mirror shot uses fake camera devices so the preview and record bar render.
 *
 * Outputs under docs/media/: pairing-screen.png, ipad-board.png,
 * laptop-mirror.png.
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const mediaDir = join(repoRoot, "docs", "media");

const BASE = process.argv[2] ?? "http://127.0.0.1:8080";
const ipadLinkFile = process.argv[3] ?? "/tmp/inkboard-ipad-link.txt";
const laptopLinkFile = process.argv[4] ?? "/tmp/inkboard-laptop-link.txt";

function pathOfLink(raw) {
  let s = raw.trim();
  if (!s) throw new Error("empty pairing link");
  // Strip scheme and/or host, keep /path?query.
  const scheme = s.indexOf("://");
  if (scheme !== -1) s = s.slice(scheme + 3);
  const slash = s.indexOf("/");
  if (slash !== -1) s = s.slice(slash);
  return s.split(/[\s)]/)[0];
}

const ipadUrl = pathOfLink(await readFile(ipadLinkFile, "utf8"));
const laptopUrl = pathOfLink(await readFile(laptopLinkFile, "utf8"));

await mkdir(mediaDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

try {
  // ------------------------------------------------------------------ 1
  // Pairing screen (a device that has never paired).
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gate = await fresh.newPage();
  await gate.goto(`${BASE}/`);
  await gate.waitForSelector("text=inkboard", { timeout: 15000 });
  await gate.waitForTimeout(800);
  await gate.screenshot({ path: join(mediaDir, "pairing-screen.png") });
  await fresh.close();

  // ------------------------------------------------------------------ 2
  // The board (editor): pair, then author a realistic lesson as the real
  // tldraw records the tools create.
  const ipad = await browser.newContext({ viewport: { width: 1366, height: 950 } });
  const board = await ipad.newPage();
  await board.goto(`${BASE}${ipadUrl}`);
  await board.waitForFunction(() => !!window.__inkboard, { timeout: 25000 });
  await board.waitForTimeout(1500); // welcome + katex settle

  // Handwritten strokes via the real Pen tool (drag = a tldraw draw shape).
  await board.click('button[title="Pen"]');
  await board.mouse.move(220, 150);
  await board.mouse.down();
  await board.mouse.move(560, 130, { steps: 30 });
  await board.mouse.move(900, 175, { steps: 30 });
  await board.mouse.up();
  await board.mouse.move(280, 260);
  await board.mouse.down();
  await board.mouse.move(620, 330, { steps: 30 });
  await board.mouse.up();
  await board.mouse.move(520, 640);
  await board.mouse.down();
  await board.mouse.move(740, 655, { steps: 20 });
  await board.mouse.up();
  await board.click('button[title="Select"]');
  await board.waitForTimeout(500);

  const scene = [
    // A heading text shape.
    { type: "inkboard-text", x: 250, y: 300, props: { w: 380, h: 52, content: "Newton's Second Law", lang: "en" } },
    // Math via KaTeX.
    { type: "inkboard-math", x: 260, y: 420, props: { w: 240, h: 76, latex: "F = ma" } },
    { type: "inkboard-math", x: 720, y: 470, props: { w: 280, h: 76, latex: "E = mc^2" } },
    // Hand-drawn shapes: a black rectangle, a red ellipse.
    { type: "geo", x: 150, y: 620, props: { w: 280, h: 170, geo: "rectangle", dash: "draw", fill: "none", color: "black", size: "m" } },
    { type: "geo", x: 660, y: 660, props: { w: 300, h: 170, geo: "ellipse", dash: "draw", fill: "none", color: "red", size: "m" } },
  ];

  const errors = await board.evaluate((shapes) => {
    const editor = window.__inkboard.editor;
    const out = [];
    for (const s of shapes) {
      try {
        editor.createShape({ type: s.type, x: s.x, y: s.y, props: s.props });
      } catch (err) {
        out.push(`${s.type}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return out;
  }, scene);
  if (errors.length > 0) console.log("shape creation errors:\n" + errors.join("\n"));

  await board.waitForTimeout(1800); // sync flush + KaTeX render
  await board.screenshot({ path: join(mediaDir, "ipad-board.png") });
  await ipad.close();

  // ------------------------------------------------------------------ 3
  // Laptop mirror: same board, camera preview + record bar, read-only.
  const lap = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const mirror = await lap.newPage();
  mirror.on("pageerror", (err) => console.log("mirror PAGE ERROR:", err.message));
  await mirror.goto(`${BASE}${laptopUrl}`);
  await mirror.waitForSelector("text=Live", { timeout: 30000 });
  await mirror.waitForTimeout(3500); // camera + board render
  await mirror.screenshot({ path: join(mediaDir, "laptop-mirror.png") });
  await lap.close();

  console.log("screenshots written to docs/media/");
} finally {
  await browser.close();
}
