import type { RecordsDiff, SyncRecord } from "@inkboard/shared-schema";

/**
 * Crash-safe local copy of the board for the *editor* device.
 *
 * Why this exists: the authoritative board lives on the server, and while the
 * editor is online that is exactly where it belongs. But the iPad's whole
 * point is that you can keep drawing with no WiFi at all, and "no WiFi" also
 * means "a tab kill loses every stroke drawn since the last reconnect":
 * nothing but the coalescing buffer in memory held them (REVIEW P1-2).
 *
 * So the editor keeps two small things in IndexedDB, written debounced and
 * again on page hide:
 *
 *  - `records` — the last server-authoritative board (what the welcome
 *    snapshot contained, folded forward by every diff whose send succeeded);
 *  - `pending` — the coalesced diff of user edits that have NOT been
 *    successfully sent yet.
 *
 * `records` deliberately never includes `pending`, which keeps the two
 * concerns separate: on boot we seed the store with `records` then apply
 * `pending` on top, so the board looks exactly as the operator left it, and
 * the `pending` diff can be re-sent once the server is reachable again. Both
 * keys are idempotent to re-apply (a record set twice to the same value is
 * harmless), so a crash mid-write can only cost the last ~700ms, never a
 * whole offline lesson.
 *
 * Security note: the board is not a recording. It contains shapes and the
 * same-origin URLs of pasted assets (never the image bytes, which live on the
 * server), and this data stays in the same-origin IndexedDB next to the
 * pairing credential it already trusts.
 */

export interface LocalBoardState {
  records: Record<string, SyncRecord>;
  schema?: Record<string, unknown>;
  pending: RecordsDiff;
}

const DB_NAME = "inkboard-local-board";
const STORE = "state";
const RECORDS_KEY = "records";
const SCHEMA_KEY = "schema";
const PENDING_KEY = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readKey<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

/** Returns the persisted editor board state, or null when nothing is stored. */
export async function loadLocalBoardState(): Promise<LocalBoardState | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null; // storage unavailable (private mode): behave like a fresh board
  }
  try {
    const [records, schema, pending] = await Promise.all([
      readKey<Record<string, SyncRecord>>(db, RECORDS_KEY),
      readKey<Record<string, unknown>>(db, SCHEMA_KEY),
      readKey<RecordsDiff>(db, PENDING_KEY),
    ]);
    if (!records) return null;
    return {
      records,
      schema,
      pending: pending ?? { added: {}, updated: {}, removed: {} },
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Persists the editor board state (records/schema/pending) in one write. */
export async function saveLocalBoardState(state: LocalBoardState): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return; // best effort: an offline board that cannot persist is a memory-only one
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put(state.records, RECORDS_KEY);
      store.put(state.pending, PENDING_KEY);
      if (state.schema) store.put(state.schema, SCHEMA_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Never let a persistence failure take down a live board session.
  } finally {
    db.close();
  }
}
