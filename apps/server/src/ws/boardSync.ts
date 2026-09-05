import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  ClientMessageSchema,
  SYNC_PROTOCOL_VERSION,
  type ServerMessage,
  type SyncRole,
} from "@inkboard/shared-schema";
import { verifySessionCredential } from "../pairing/tokens.js";
import type { BoardState } from "./boardState.js";

/**
 * A single oversized or malformed frame must not be able to exhaust memory.
 * Board diffs are small; a full snapshot of a dense lesson is the large case,
 * and 8 MB is far above it while still bounding the damage.
 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** A socket that never says hello is closed rather than left occupying a slot. */
const AUTH_DEADLINE_MS = 10_000;

/** Heartbeat: a dozing iPad's socket can die without ever sending a close frame. */
const HEARTBEAT_INTERVAL_MS = 30_000;

interface Peer {
  socket: WebSocket;
  role: SyncRole;
  authenticated: boolean;
  alive: boolean;
  /**
   * Retained so the credential can be revalidated on every heartbeat. Checking
   * only at hello meant a credential that was later revoked, or evicted by the
   * device cap, kept full write access for as long as its socket stayed open.
   */
  token: string | null;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A failed send means the socket is going away; the close handler cleans up.
  }
}

function fail(
  socket: WebSocket,
  code:
    | "bad-message"
    | "not-an-editor"
    | "too-large"
    | "unsupported-version"
    | "unauthenticated"
    | "editor-contended",
  message: string,
): void {
  send(socket, { v: SYNC_PROTOCOL_VERSION, type: "error", code, message });
}

/**
 * Live board mirroring. One device holds the pen (`editor`, the iPad) and any
 * number of read-only `mirror` views (the laptop) follow along.
 *
 * The server keeps the authoritative board rather than blindly relaying, so a
 * device joining late or reconnecting gets the current canvas instead of an
 * empty one. Diffs are relayed to every other peer, never echoed to the
 * sender, which would fight the sender's own local state.
 */
export async function registerBoardSync(
  app: FastifyInstance,
  board: BoardState,
): Promise<void> {
  const peers = new Set<Peer>();

  function broadcast(message: ServerMessage, except?: Peer): void {
    for (const peer of peers) {
      if (peer === except || !peer.authenticated) continue;
      send(peer.socket, message);
    }
  }

  function announcePeers(): void {
    const count = [...peers].filter((p) => p.authenticated).length;
    broadcast({ v: SYNC_PROTOCOL_VERSION, type: "peers", peers: count });
  }

  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      // Revalidate here rather than only at hello, so revoking sessions or
      // exceeding the device cap actually ejects a connected device instead
      // of leaving it writing to the board until it happens to disconnect.
      if (peer.authenticated && peer.token && !verifySessionCredential(peer.token)) {
        fail(peer.socket, "unauthenticated", "session credential is no longer valid");
        peer.socket.close(4401, "session revoked");
        continue;
      }

      if (!peer.alive) {
        // Missed the previous round trip: assume the socket is dead.
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      try {
        peer.socket.ping();
      } catch {
        peer.socket.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    board.close();
  });

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const peer: Peer = {
      socket,
      role: "mirror",
      authenticated: false,
      alive: true,
      token: null,
    };
    peers.add(peer);

    const authTimer = setTimeout(() => {
      if (!peer.authenticated) {
        fail(socket, "unauthenticated", "no hello before the deadline");
        socket.close(4401, "unauthenticated");
      }
    }, AUTH_DEADLINE_MS);
    authTimer.unref?.();

    socket.on("pong", () => {
      peer.alive = true;
    });

    socket.on("message", (raw: Buffer) => {
      if (raw.length > MAX_FRAME_BYTES) {
        fail(socket, "too-large", `frame exceeds ${MAX_FRAME_BYTES} bytes`);
        socket.close(1009, "frame too large");
        return;
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString("utf8"));
      } catch {
        fail(socket, "bad-message", "not valid JSON");
        return;
      }

      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        // Never log the payload: a hello frame carries the session credential.
        fail(socket, "bad-message", "message did not match the sync protocol");
        return;
      }
      const message = parsed.data;

      if (message.type === "hello") {
        // One hello per socket. Without this a connection that authenticated
        // as a read-only mirror could send a second hello claiming
        // role "editor" and promote itself to write access.
        if (peer.authenticated) {
          fail(socket, "bad-message", "already authenticated on this socket");
          return;
        }

        if (!verifySessionCredential(message.token)) {
          fail(socket, "unauthenticated", "invalid or expired session credential");
          socket.close(4401, "invalid or expired session credential");
          return;
        }

        // One pen at a time. Two editors would each be excluded from their own
        // broadcasts, and with no revision numbers on the wire there is
        // nothing to converge them: concurrent edits to one shape would leave
        // the two devices permanently disagreeing.
        //
        // Takeover is allowed in exactly two cases, so two *different* live
        // editors cannot replace each other forever:
        //  1. same credential — a reconnecting iPad routinely arrives before
        //     the server has noticed its previous socket died; refusing it
        //     would lock the operator out of their own board until a
        //     heartbeat happened to reap the zombie. Same device, so the
        //     stale socket is simply replaced.
        //  2. explicit `takeover: true` in the hello — the operator looked at
        //     the "another device has the pen" notice and chose to take
        //     over. Anything else from a different device is refused with
        //     `editor-contended` and the incumbent keeps the pen untouched.
        if (message.role === "editor") {
          const otherEditors = [...peers].filter(
            (p) => p !== peer && p.authenticated && p.role === "editor",
          );
          const differentDevice = otherEditors.filter(
            (o) => o.token !== message.token,
          );
          if (differentDevice.length > 0 && message.takeover !== true) {
            fail(
              socket,
              "editor-contended",
              "another device already holds the pen; set takeover to replace it",
            );
            socket.close(4408, "editor contended");
            return;
          }
          // Same-device reconnect(s), and/or a confirmed takeover: replace
          // the incumbent(s).
          for (const other of otherEditors) {
            fail(other.socket, "not-an-editor", "another device took over the pen");
            other.socket.close(4409, "replaced by a newer editor");
            peers.delete(other);
          }
        }

        peer.authenticated = true;
        peer.role = message.role;
        peer.token = message.token;
        clearTimeout(authTimer);

        send(socket, {
          v: SYNC_PROTOCOL_VERSION,
          type: "welcome",
          role: peer.role,
          records: board.snapshot(),
          schema: board.serializedSchema(),
          peers: [...peers].filter((p) => p.authenticated).length,
        });
        app.log.info({ role: peer.role }, "board sync peer joined");
        announcePeers();
        return;
      }

      if (!peer.authenticated) {
        fail(socket, "unauthenticated", "hello must come first");
        socket.close(4401, "unauthenticated");
        return;
      }

      if (message.type === "ping") {
        send(socket, { v: SYNC_PROTOCOL_VERSION, type: "pong" });
        return;
      }

      // A mirror is strictly a viewer. Enforcing that here rather than trusting
      // the client means a buggy or tampered-with laptop cannot corrupt the
      // board the iPad is actively drawing on.
      if (peer.role !== "editor") {
        fail(socket, "not-an-editor", "this connection is read-only");
        return;
      }

      if (message.type === "diff") {
        board.applyDiff(message.diff);
        broadcast(
          { v: SYNC_PROTOCOL_VERSION, type: "diff", diff: message.diff },
          peer,
        );
        return;
      }

      if (message.type === "snapshot") {
        board.replaceAll(message.records, message.schema);
        // Everyone else needs the whole board, not a diff they cannot apply.
        for (const other of peers) {
          if (other === peer || !other.authenticated) continue;
          send(other.socket, {
            v: SYNC_PROTOCOL_VERSION,
            type: "welcome",
            role: other.role,
            records: board.snapshot(),
            schema: board.serializedSchema(),
            peers: [...peers].filter((p) => p.authenticated).length,
          });
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      peers.delete(peer);
      announcePeers();
    });

    socket.on("error", () => {
      clearTimeout(authTimer);
      peers.delete(peer);
    });
  });
}
