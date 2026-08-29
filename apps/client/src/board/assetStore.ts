import type { TLAssetStore } from "tldraw";

/**
 * Sends pasted or dropped media to the server and references it by URL.
 *
 * tldraw's default asset store inlines files as base64 data URLs. That works
 * on one device and fails the moment there are two: the data URL would bloat
 * every board diff by the whole file, and the record would still only render
 * where it was pasted. Uploading once and syncing a short URL is what makes
 * "paste an image on the laptop, see it on the iPad" work at all.
 */
export function createAssetStore(getToken: () => string | null): TLAssetStore {
  return {
    async upload(_asset, file) {
      const token = getToken();
      if (!token) throw new Error("not paired, cannot upload an asset");

      const res = await fetch("/api/assets", {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          authorization: `Bearer ${token}`,
        },
        body: file,
      });

      if (!res.ok) {
        // Thrown so tldraw surfaces its own "failed to upload" state rather
        // than silently placing a shape that points at nothing.
        throw new Error(`asset upload failed with ${res.status}`);
      }

      const { src } = (await res.json()) as { src: string };
      return { src };
    },

    // The stored src is already a same-origin path both devices can fetch,
    // so there is nothing to rewrite.
    resolve(asset) {
      return asset.props.src ?? null;
    },
  };
}
