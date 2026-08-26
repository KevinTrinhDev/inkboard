import { listQueuedUploads, removeQueuedUpload } from "./offlineQueue";

const RETRY_INTERVAL_MS = 15_000;

/**
 * Drains the offline upload queue whenever a connection to the server
 * exists. Recording itself never depends on this running: it only decides
 * *when* an already-finished, already-encrypted recording actually reaches
 * the XPS. Safe to call `flushNow` as often as you like; it no-ops while a
 * flush is already in flight.
 */
export function startSyncLoop(
  getToken: () => string | null,
  onQueueChange: (pendingCount: number) => void,
  onCredentialInvalid: () => void = () => {},
): { flushNow: () => void; stop: () => void } {
  let flushing = false;

  async function flushOnce() {
    if (flushing) return;
    flushing = true;
    try {
      const token = getToken();
      if (!token) return;

      const pending = await listQueuedUploads();
      onQueueChange(pending.length);

      for (const item of pending) {
        try {
          const res = await fetch(`/api/sessions/${item.sessionId}/upload`, {
            method: "POST",
            headers: { "x-pairing-token": token },
            body: item.blob,
          });
          if (res.ok) {
            await removeQueuedUpload(item.sessionId);
          } else if (res.status === 401) {
            // Credential expired/invalid: bounce back to the pairing
            // screen immediately rather than silently leaving the take
            // queued forever with no indication anything is wrong.
            onCredentialInvalid();
            break;
          }
          // Any other non-OK status: leave it queued, retry next pass.
        } catch {
          // Offline or server unreachable: stop this pass, the interval
          // (or the next `online` event) will retry.
          break;
        }
      }

      onQueueChange((await listQueuedUploads()).length);
    } finally {
      flushing = false;
    }
  }

  void flushOnce();
  const interval = setInterval(() => void flushOnce(), RETRY_INTERVAL_MS);
  const onOnline = () => void flushOnce();
  window.addEventListener("online", onOnline);

  return {
    flushNow: () => void flushOnce(),
    stop: () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
    },
  };
}
