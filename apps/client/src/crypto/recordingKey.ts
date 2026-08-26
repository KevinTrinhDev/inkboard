/**
 * The recording encryption key lives ONLY in this device's IndexedDB. It is
 * generated once on-device, never leaves the device, and is never sent to
 * the server in any form. That is what makes recordings encrypted at rest
 * on the server "end-to-end" rather than merely "transport-encrypted": the
 * server (and anyone with access to it) only ever holds ciphertext it has
 * no way to decrypt. See docs/SECURITY.md "Encryption at rest".
 *
 * Trade-off worth knowing: losing this device's browser storage (reset,
 * reinstall, cleared site data) means losing the key permanently: there is
 * no recovery, by design. That's the same trade-off any real E2E scheme
 * makes; a recoverable key would mean something other than the device could
 * decrypt, which defeats the point.
 */

const DB_NAME = "inkboard-crypto";
const STORE = "keys";
const KEY_ID = "recording-key";
const IV_LENGTH_BYTES = 12;

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

async function loadRawKey(db: IDBDatabase): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(KEY_ID);
    request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function saveRawKey(db: IDBDatabase, raw: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(raw, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cachedKey: CryptoKey | null = null;

/** Returns this device's AES-256-GCM recording key, generating one on first use. */
export async function getOrCreateRecordingKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const db = await openDb();
  try {
    const existing = await loadRawKey(db);
    if (existing) {
      cachedKey = await crypto.subtle.importKey("raw", existing, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
      return cachedKey;
    }

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    const raw = await crypto.subtle.exportKey("raw", key);
    await saveRawKey(db, raw);
    cachedKey = key;
    return key;
  } finally {
    db.close();
  }
}

/** Encrypts a blob with a fresh random IV, prepending the IV to the ciphertext. */
export async function encryptBlob(key: CryptoKey, blob: Blob): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintext = new Uint8Array(await blob.arrayBuffer());
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );

  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return new Blob([out], { type: "application/octet-stream" });
}

/** Inverse of {@link encryptBlob}: reads the prepended IV and decrypts the rest. */
export async function decryptBlob(key: CryptoKey, blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const iv = bytes.slice(0, IV_LENGTH_BYTES);
  const ciphertext = bytes.slice(IV_LENGTH_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Blob([plaintext], { type: "video/webm" });
}
