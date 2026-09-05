import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import {
  emptyRecordsDiff,
  isEmptyRecordsDiff,
  ServerMessageSchema,
  squashRecordsDiff,
  SYNC_PROTOCOL_VERSION,
  type ClientMessage,
  type RecordsDiff,
  type SyncRole,
} from "@inkboard/shared-schema";

export type SyncStatus = "connecting" | "live" | "offline" | "contended";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/** Diffs are coalesced over one frame so a fast stroke is not one send per point. */
const FLUSH_INTERVAL_MS = 50;

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Mirrors the tldraw document across devices over the /ws hub.
 *
 * `editor` role sends local changes and applies remote ones; `mirror` is a
 * read-only viewer. Reconnects with exponential backoff, because the laptop
 * mirror is expected to sit open for a whole lesson while the iPad sleeps,
 * roams between APs, or the server restarts.
 */
export function useBoardSync(
  editor: Editor | null,
  token: string | null,
  role: SyncRole,
  /**
   * Called when the server rejects this credential outright (expired, or
   * evicted once the device cap was exceeded) rather than merely dropping
   * the connection. Without this the board sits on "Reconnecting" forever
   * with no way to tell why or to fix it.
   */
  onCredentialInvalid: () => void = () => {},
): { status: SyncStatus; peers: number; takeOver: () => void } {
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [peers, setPeers] = useState(0);

  // Kept in refs so reconnecting never re-runs the effect and tears down the
  // editor subscription underneath itself.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const roleRef = useRef(role);
  roleRef.current = role;
  const onCredentialInvalidRef = useRef(onCredentialInvalid);
  onCredentialInvalidRef.current = onCredentialInvalid;

  /**
   * True while this device has been told another device holds the pen
   * (`editor-contended`). While set, a socket close is NOT a transient
   * disconnect: reconnecting without a takeover flag would just be refused
   * again, forever.
   */
  const contendedRef = useRef(false);
  /**
   * Set by the "take over" action; the next hello carries `takeover: true`
   * and is cleared once the server has welcomed this device.
   */
  const takeoverRef = useRef(false);
  /** Points at the current effect's reconnect trigger, so the returned
   *  `takeOver()` can reach inside the effect closure. */
  const requestTakeOverRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!editor || !token) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: number | undefined;
    let flushTimer: number | undefined;
    let unlisten: (() => void) | undefined;

    /** True while applying a server diff, so we never bounce it back. */
    let applyingRemote = false;
    /** Set once the server has answered hello; nothing is sent before then. */
    let welcomed = false;
    let pending = emptyRecordsDiff();

    /** Returns whether the frame actually reached the socket. */
    const send = (message: ClientMessage): boolean => {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    };

    const flush = () => {
      // Hold everything until the server has answered hello. Sending before
      // then races the welcome: the server would accept the diff and then the
      // already-queued snapshot would overwrite it locally, leaving this
      // device behind the board it just edited.
      if (!welcomed || isEmptyRecordsDiff(pending)) return;

      const diff = pending;
      // tldraw's RecordsDiff and the wire RecordsDiff are the same shape.
      // Only clear after a confirmed send: clearing first meant edits made
      // while the iPad was asleep or roaming between access points were
      // dropped on the floor, then erased for good by the next snapshot.
      if (send({ v: SYNC_PROTOCOL_VERSION, type: "diff", diff })) {
        pending = emptyRecordsDiff();
      }
    };

    const connect = () => {
      if (disposed) return;
      setStatus(reconnectAttempt === 0 ? "connecting" : "offline");

      let ws: WebSocket;
      try {
        ws = new WebSocket(socketUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        // Deliberately not resetting reconnectAttempt here: a server that
        // accepts the TCP connection and immediately drops it (a partial
        // restart) would reset the backoff on every attempt and turn this
        // into a 500ms reconnect storm. It resets on welcome instead.
        send({
          v: SYNC_PROTOCOL_VERSION,
          type: "hello",
          role: roleRef.current,
          token: tokenRef.current ?? "",
          // Only after the operator picked "take over": tells the server to
          // replace the device that currently holds the pen.
          ...(takeoverRef.current ? { takeover: true } : {}),
        });
      };

      ws.onmessage = (event) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(event.data));
        } catch {
          return;
        }

        const parsed = ServerMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        const current = editorRef.current;
        if (!current) return;

        switch (message.type) {
          case "welcome": {
            reconnectAttempt = 0;
            welcomed = true;
            contendedRef.current = false;
            takeoverRef.current = false;
            setStatus("live");
            setPeers(message.peers);

            const hasRemoteBoard = Object.keys(message.records).length > 0;
            if (hasRemoteBoard) {
              // Local edits made while connecting are carried across the
              // snapshot load rather than lost to it. loadStoreSnapshot
              // replaces the whole store, so without this a stroke drawn
              // during reconnect would vanish from this device even though
              // the server had already accepted it.
              const carried = pending;
              pending = emptyRecordsDiff();

              applyingRemote = true;
              try {
                current.store.mergeRemoteChanges(() => {
                  current.store.loadStoreSnapshot({
                    store: message.records as never,
                    schema: (message.schema ??
                      current.store.schema.serialize()) as never,
                  });
                });
              } finally {
                applyingRemote = false;
              }

              // loadStoreSnapshot clears the store and recreates the session
              // records it needs, and a recreated instance record defaults to
              // isReadonly: false. Without this the mirror silently becomes
              // editable the first time it receives a board.
              if (roleRef.current === "mirror") {
                current.updateInstanceState({ isReadonly: true });
              }

              if (roleRef.current === "editor" && !isEmptyRecordsDiff(carried)) {
                // Replayed as a local change so the listener re-queues it and
                // it flushes normally, putting this device's work back on top
                // of the authoritative board.
                current.store.applyDiff(carried as never);
              }
            } else if (roleRef.current === "editor") {
              // Server has nothing yet: seed it from this device so a mirror
              // joining later sees the existing board rather than a blank one.
              const snapshot = current.store.getStoreSnapshot();
              send({
                v: SYNC_PROTOCOL_VERSION,
                type: "snapshot",
                records: snapshot.store as never,
                schema: snapshot.schema as never,
              });
            }
            break;
          }

          case "diff": {
            applyingRemote = true;
            try {
              current.store.mergeRemoteChanges(() => {
                current.store.applyDiff(message.diff as never);
              });
            } finally {
              applyingRemote = false;
            }
            break;
          }

          case "peers":
            setPeers(message.peers);
            break;

          case "error":
            // Surfaced through status rather than thrown: a mirror that tries
            // to write should not crash the board.
            if (message.code === "unauthenticated") {
              setStatus("offline");
              onCredentialInvalidRef.current();
            } else if (
              message.code === "editor-contended" &&
              roleRef.current === "editor"
            ) {
              // Another device holds the pen and we did not ask to take over.
              // Stop reconnecting (the server would refuse again) and let the
              // UI offer an explicit takeover instead.
              contendedRef.current = true;
              takeoverRef.current = false;
              setStatus("contended");
            }
            break;

          default:
            break;
        }
      };

      ws.onclose = (event) => {
        socket = null;
        welcomed = false;
        if (!disposed) {
          if (contendedRef.current || event.code === 4408) {
            // 4408 = the server refused this editor because another device
            // holds the pen. Do not auto-reconnect into an endless
            // refuse-forever loop; surface the takeover choice instead.
            contendedRef.current = true;
            setStatus("contended");
          } else {
            setStatus("offline");
            scheduleReconnect();
          }
        }
      };

      ws.onerror = () => {
        // onclose always follows, which is where reconnect is handled.
        ws.close();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttempt,
        RECONNECT_MAX_MS,
      );
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    /**
     * User-confirmed "give me the pen": clears the contended state, arms the
     * takeover flag and forces a reconnect, whose hello then replaces the
     * other device's editor socket server-side.
     */
    const requestTakeOver = () => {
      contendedRef.current = false;
      takeoverRef.current = true;
      reconnectAttempt = 0;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        // The onclose handler sees the cleared contended flag and schedules
        // the reconnect that carries takeover: true.
        try {
          socket.close();
          return;
        } catch {
          // fall through to scheduleReconnect
        }
      }
      scheduleReconnect();
    };
    requestTakeOverRef.current = requestTakeOver;

    // Only local, document-scope changes go on the wire. store.listen defaults
    // to source 'all', which would echo every diff we just applied from the
    // server straight back to it in a loop.
    if (role === "editor") {
      unlisten = editor.store.listen(
        (entry) => {
          if (applyingRemote) return;
          squashRecordsDiff(pending, entry.changes as unknown as RecordsDiff);
        },
        { source: "user", scope: "document" },
      );

      flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);
    }

    connect();

    return () => {
      disposed = true;
      unlisten?.();
      if (flushTimer !== undefined) window.clearInterval(flushTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
    // role is intentionally a dependency: switching between board and mirror
    // must rebuild the subscription.
  }, [editor, token, role]);

  return {
    status,
    peers,
    takeOver: () => requestTakeOverRef.current(),
  };
}
