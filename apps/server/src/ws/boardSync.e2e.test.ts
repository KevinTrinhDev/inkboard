import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  applyRecordsDiff,
  SYNC_PROTOCOL_VERSION,
  type ServerMessage,
  type SyncRecord,
} from "@inkboard/shared-schema";
import { buildApp } from "../app.js";
import { generateSessionCredential } from "../pairing/tokens.js";

const V = SYNC_PROTOCOL_VERSION;

/**
 * Drives the hub over a real listening socket rather than inject(), so this
 * exercises the same path the iPad and the laptop actually use.
 */
class TestClient {
  private readonly inbox: ServerMessage[] = [];
  private readonly waiters: ((m: ServerMessage) => void)[] = [];
  /** Board as this client sees it, rebuilt from the frames it receives. */
  board: Record<string, SyncRecord> = {};

  private constructor(private readonly ws: WebSocket) {}

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    const client = new TestClient(ws);

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "welcome") client.board = { ...message.records };
      if (message.type === "diff") {
        client.board = applyRecordsDiff(client.board, message.diff);
      }
      const waiter = client.waiters.shift();
      if (waiter) waiter(message);
      else client.inbox.push(message);
    });

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("socket error")));
    });
    return client;
  }

  next(): Promise<ServerMessage> {
    const buffered = this.inbox.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out")), 3000);
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Consumes frames until this client's view of the board satisfies
   * `predicate`. Waiting on a frame count would be racy: the hub interleaves
   * `peers` announcements with diffs whenever a device joins or leaves.
   */
  async waitForBoard(
    predicate: (board: Record<string, SyncRecord>) => boolean,
  ): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!predicate(this.board)) {
      if (Date.now() > deadline) {
        throw new Error("board never reached the expected state");
      }
      await this.next();
    }
  }

  async hello(role: "editor" | "mirror"): Promise<void> {
    this.send({ v: V, type: "hello", role, token: generateSessionCredential() });
    const welcome = await this.next();
    if (welcome.type !== "welcome") throw new Error(`expected welcome, got ${welcome.type}`);
  }

  close(): void {
    this.ws.close();
  }
}

describe("board sync end to end over a real socket", () => {
  let app: FastifyInstance;
  let dir: string;
  let clientDist: string;
  let url: string;

  beforeAll(() => {
    process.env.PAIRING_TOKEN_SECRET = "test-secret-not-for-real-use";
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "inkboard-e2e-"));
    clientDist = mkdtempSync(join(tmpdir(), "inkboard-e2e-dist-"));
    writeFileSync(join(clientDist, "index.html"), "<!doctype html>");

    app = await buildApp({
      clientDist,
      boardStatePath: join(dir, "board-state.json"),
      assetsDir: join(dir, "assets"),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    url = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(clientDist, { recursive: true, force: true });
  });

  it("propagates a drawing from the iPad to the laptop mirror", async () => {
    const ipad = await TestClient.connect(url);
    await ipad.hello("editor");

    const laptop = await TestClient.connect(url);
    await laptop.hello("mirror");

    ipad.send({
      v: V,
      type: "diff",
      diff: {
        added: { "shape:stroke1": { id: "shape:stroke1", typeName: "draw" } },
        updated: {},
        removed: {},
      },
    });

    await laptop.waitForBoard((board) => "shape:stroke1" in board);
    expect(laptop.board["shape:stroke1"]).toMatchObject({ typeName: "draw" });

    ipad.close();
    laptop.close();
  });

  it("converges both devices after a burst of edits", async () => {
    const ipad = await TestClient.connect(url);
    await ipad.hello("editor");
    const laptop = await TestClient.connect(url);
    await laptop.hello("mirror");

    for (let i = 0; i < 25; i += 1) {
      ipad.send({
        v: V,
        type: "diff",
        diff: {
          added: { [`shape:s${i}`]: { id: `shape:s${i}`, typeName: "draw", i } },
          updated: {},
          removed: {},
        },
      });
    }
    await laptop.waitForBoard((board) => Object.keys(board).length === 25);

    // Then delete half of them.
    for (let i = 0; i < 25; i += 2) {
      ipad.send({
        v: V,
        type: "diff",
        diff: {
          added: {},
          updated: {},
          removed: { [`shape:s${i}`]: { id: `shape:s${i}` } },
        },
      });
    }
    await laptop.waitForBoard((board) => Object.keys(board).length === 12);

    expect(Object.keys(laptop.board).sort()).toEqual(
      Array.from({ length: 12 }, (_, k) => `shape:s${k * 2 + 1}`).sort(),
    );

    ipad.close();
    laptop.close();
  });

  it("hands a device that reconnects the full board, not a blank one", async () => {
    const ipad = await TestClient.connect(url);
    await ipad.hello("editor");

    ipad.send({
      v: V,
      type: "diff",
      diff: {
        added: { "shape:kept": { id: "shape:kept", typeName: "draw" } },
        updated: {},
        removed: {},
      },
    });
    ipad.send({ v: V, type: "ping" });
    await ipad.next();

    // Simulates the iPad sleeping and the socket dying mid-lesson.
    ipad.close();

    const returning = await TestClient.connect(url);
    await returning.hello("editor");

    expect(returning.board["shape:kept"]).toBeDefined();
    returning.close();
  });

  it("survives a server restart by reloading the persisted board", async () => {
    const ipad = await TestClient.connect(url);
    await ipad.hello("editor");
    ipad.send({
      v: V,
      type: "diff",
      diff: {
        added: { "shape:durable": { id: "shape:durable", typeName: "draw" } },
        updated: {},
        removed: {},
      },
    });
    ipad.send({ v: V, type: "ping" });
    await ipad.next();
    ipad.close();

    // close() flushes the debounced write, which is what makes the board
    // survive the restart rather than being lost in the coalescing window.
    await app.close();

    app = await buildApp({
      clientDist,
      boardStatePath: join(dir, "board-state.json"),
      assetsDir: join(dir, "assets"),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");

    const after = await TestClient.connect(`ws://127.0.0.1:${address.port}/ws`);
    await after.hello("editor");

    expect(after.board["shape:durable"]).toBeDefined();
    after.close();
  });
});
