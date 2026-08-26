/**
 * Durable queue for encrypted recordings waiting to reach the server. A
 * finished recording is written here immediately, before any network
 * attempt, so recording works with zero connectivity and nothing is lost
 * if the tab closes or the device goes offline mid-upload. syncManager.ts
 * drains this queue whenever a connection exists.
 */

export interface QueuedUpload {
  sessionId: string;
  createdAt: number;
  blob: Blob;
}

const DB_NAME = "inkboard-upload-queue";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "sessionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueUpload(sessionId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    const item: QueuedUpload = { sessionId, createdAt: Date.now(), blob };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function listQueuedUploads(): Promise<QueuedUpload[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as QueuedUpload[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function removeQueuedUpload(sessionId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
