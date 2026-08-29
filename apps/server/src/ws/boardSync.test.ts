import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  SYNC_PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@inkboard/shared-schema";
import { buildApp } from "../app.js";
import { generateSessionCredential } from "../pairing/tokens.js";

const V = SYNC_PROTOCOL_VERSION;

/** Waits for the next JSON frame, failing loudly instead of hanging forever. */
function nextMessage(socket: {
  once(event: string, cb: (data: unknown) => void): void;
}): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 3000);
    socket.once("message", (data: unknown) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)) as ServerMessage);
    });
  });
}

function send(socket: { send(data: string): void }, message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

/** A credential that passes verifySessionCredential. */
function freshCredential(): string {
  return generateSessionCredential();
}

function record(id: string, extra: Record<string, unknown> = {}) {
  return { id, typeName: "shape", ...extra };
}

describe("board sync hub", () => {
  beforeAll(() => {
    process.env.PAIRING_TOKEN_SECRET = "test-secret-not-for-real-use";
  });

  let app: FastifyInstance;
  let dir: string;
  let clientDist: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "inkboard-board-"));
    clientDist = mkdtempSync(join(tmpdir(), "inkboard-dist-"));
    writeFileSync(join(clientDist, "index.html"), "<!doctype html>");

    app = await buildApp({
      clientDist,
      boardStatePath: join(dir, "board-state.json"),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(clientDist, { recursive: true, force: true });
  });

  it("welcomes an authenticated editor with the current board", async () => {
    const socket = await app.injectWS("/ws");
    send(socket, { v: V, type: "hello", role: "editor", token: freshCredential() });

    const welcome = await nextMessage(socket);
    expect(welcome.type).toBe("welcome");
    if (welcome.type !== "welcome") throw new Error("expected welcome");
    expect(welcome.role).toBe("editor");
    expect(welcome.records).toEqual({});
    socket.terminate();
  });

  it("rejects a hello carrying an invalid credential", async () => {
    const socket = await app.injectWS("/ws");
    send(socket, { v: V, type: "hello", role: "editor", token: "not-a-credential" });

    const msg = await nextMessage(socket);
    expect(msg.type).toBe("error");
    if (msg.type !== "error") throw new Error("expected error");
    expect(msg.code).toBe("unauthenticated");
    socket.terminate();
  });

  it("refuses board traffic before hello", async () => {
    const socket = await app.injectWS("/ws");
    send(socket, {
      v: V,
      type: "diff",
      diff: { added: { "shape:a": record("shape:a") }, updated: {}, removed: {} },
    });

    const msg = await nextMessage(socket);
    expect(msg.type).toBe("error");
    if (msg.type !== "error") throw new Error("expected error");
    expect(msg.code).toBe("unauthenticated");
    socket.terminate();
  });

  it("relays an editor's diff to a mirror without echoing it back", async () => {
    const editor = await app.injectWS("/ws");
    send(editor, { v: V, type: "hello", role: "editor", token: freshCredential() });
    await nextMessage(editor); // welcome

    const mirror = await app.injectWS("/ws");
    send(mirror, { v: V, type: "hello", role: "mirror", token: freshCredential() });
    await nextMessage(mirror); // welcome

    const relayed = nextMessage(mirror);
    send(editor, {
      v: V,
      type: "diff",
      diff: {
        added: { "shape:a": record("shape:a", { x: 1 }) },
        updated: {},
        removed: {},
      },
    });

    const msg = await relayed;
    expect(msg.type).toBe("diff");
    if (msg.type !== "diff") throw new Error("expected diff");
    expect(msg.diff.added["shape:a"]).toMatchObject({ id: "shape:a", x: 1 });

    editor.terminate();
    mirror.terminate();
  });

  it("refuses a diff sent by a read-only mirror", async () => {
    const mirror = await app.injectWS("/ws");
    send(mirror, { v: V, type: "hello", role: "mirror", token: freshCredential() });
    await nextMessage(mirror); // welcome

    send(mirror, {
      v: V,
      type: "diff",
      diff: { added: { "shape:x": record("shape:x") }, updated: {}, removed: {} },
    });

    const msg = await nextMessage(mirror);
    expect(msg.type).toBe("error");
    if (msg.type !== "error") throw new Error("expected error");
    expect(msg.code).toBe("not-an-editor");
    mirror.terminate();
  });

  it("gives a late joiner the accumulated board, not an empty canvas", async () => {
    const editor = await app.injectWS("/ws");
    send(editor, { v: V, type: "hello", role: "editor", token: freshCredential() });
    await nextMessage(editor);

    send(editor, {
      v: V,
      type: "diff",
      diff: {
        added: { "shape:a": record("shape:a"), "shape:b": record("shape:b") },
        updated: {},
        removed: {},
      },
    });
    send(editor, {
      v: V,
      type: "diff",
      diff: { added: {}, updated: {}, removed: { "shape:a": record("shape:a") } },
    });
    // Round-trip a ping so both diffs are known to have been processed.
    send(editor, { v: V, type: "ping" });
    await nextMessage(editor);

    const late = await app.injectWS("/ws");
    send(late, { v: V, type: "hello", role: "mirror", token: freshCredential() });
    const welcome = await nextMessage(late);

    if (welcome.type !== "welcome") throw new Error("expected welcome");
    expect(Object.keys(welcome.records)).toEqual(["shape:b"]);

    editor.terminate();
    late.terminate();
  });

  it("answers a malformed frame with an error rather than closing", async () => {
    const socket = await app.injectWS("/ws");
    socket.send("this is not json");

    const msg = await nextMessage(socket);
    expect(msg.type).toBe("error");
    if (msg.type !== "error") throw new Error("expected error");
    expect(msg.code).toBe("bad-message");
    socket.terminate();
  });

  it("rejects a message that does not match the protocol", async () => {
    const socket = await app.injectWS("/ws");
    // An unknown discriminator cannot be coerced into any member of the
    // union. A diff carrying unknown keys would parse instead: every
    // RecordsDiff field defaults to {}, so it becomes an empty diff.
    socket.send(JSON.stringify({ v: V, type: "definitely-not-a-message" }));

    const msg = await nextMessage(socket);
    expect(msg.type).toBe("error");
    if (msg.type !== "error") throw new Error("expected error");
    expect(msg.code).toBe("bad-message");
    socket.terminate();
  });
});
