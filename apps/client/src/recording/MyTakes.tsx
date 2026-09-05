import { useCallback, useEffect, useState } from "react";
import { DownloadIcon } from "../board/icons";
import { usePairingToken } from "../pairing/PairingGate";
import { accent, glass, text } from "../ui/tokens";
import { decryptBlob, getOrCreateRecordingKey } from "../crypto/recordingKey";

interface Take {
  id: string;
  mime: string;
  bytes: number;
  at: string;
}

/**
 * "My takes" for the capture device: lists the recordings that reached the
 * server and lets the operator download a *decrypted, playable* copy.
 *
 * Decryption happens here, in the browser that holds the key (the recording
 * device): the server only ever has ciphertext. The downloaded file is the
 * original WebM/MP4 the recorder produced, ready to watch, edit or upload to
 * YouTube.
 */
export function MyTakesButton() {
  const token = usePairingToken();
  const [open, setOpen] = useState(false);
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await fetch("/api/takes", {
        headers: { "x-pairing-token": token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { takes: Take[] };
      setTakes(data.takes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not load takes");
      setTakes([]);
    }
  }, [token]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function downloadTake(take: Take) {
    if (!token || busyId) return;
    setBusyId(take.id);
    setError(null);
    try {
      const res = await fetch(`/api/takes/${take.id}`, {
        headers: { "x-pairing-token": token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const key = await getOrCreateRecordingKey();
      const media = await decryptBlob(key, await res.blob(), take.mime);
      const ext = take.mime === "video/mp4" ? "mp4" : "webm";
      const name = `inkboard-take-${take.id.slice(0, 8)}.${ext}`;
      const url = URL.createObjectURL(media);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setFlash(`Saved ${name} — ready to watch or upload`);
    } catch (err) {
      setError(
        `Could not decrypt ${take.id.slice(0, 8)}: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    } finally {
      setBusyId(null);
    }
  }

  function humanSize(bytes: number): string {
    if (!bytes) return "—";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function humanDate(at: string): string {
    if (!at) return "recent";
    const d = new Date(at);
    return Number.isNaN(d.getTime())
      ? "recent"
      : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const pillStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: open ? accent.active : "transparent",
    color: text.muted,
    border: open ? "1.5px solid rgba(255,255,255,0.2)" : "1.5px solid transparent",
    borderRadius: 10,
    cursor: "pointer",
    touchAction: "manipulation",
  };

  return (
    <>
      <button
        title="My takes (download recordings)"
        aria-label="My takes"
        style={pillStyle}
        onClick={() => setOpen((o) => !o)}
      >
        <DownloadIcon width={18} height={18} />
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 140,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1300,
            width: "min(92vw, 460px)",
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
            background: glass.surface,
            backdropFilter: glass.blur,
            WebkitBackdropFilter: glass.blur,
            border: `1px solid ${glass.border}`,
            borderRadius: 16,
            boxShadow: glass.shadow,
            padding: 12,
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: text.onDim,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>My takes</strong>
            <button
              title="Refresh"
              aria-label="Refresh takes"
              onClick={() => void refresh()}
              style={{
                marginLeft: "auto",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 8,
                background: "transparent",
                color: "#fff",
                padding: "2px 10px",
                cursor: "pointer",
                fontSize: 12,
                touchAction: "manipulation",
              }}
            >
              Refresh
            </button>
            <button
              title="Close"
              aria-label="Close"
              onClick={() => setOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: "2px 4px",
                touchAction: "manipulation",
              }}
            >
              ✕
            </button>
          </div>

          {flash && (
            <div style={{ color: "#4ade80", fontSize: 12.5, marginBottom: 8 }}>{flash}</div>
          )}
          {error && (
            <div role="alert" style={{ color: "#f87171", fontSize: 12.5, marginBottom: 8 }}>
              {error}
            </div>
          )}

          {takes === null ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>Loading…</div>
          ) : takes.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 13, padding: 6 }}>
              Nothing here yet — record a take and it will appear once it has synced.
            </div>
          ) : (
            takes.map((take) => (
              <div
                key={take.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 4px",
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                  fontSize: 13,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {humanDate(take.at)}
                  </div>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>
                    {take.mime === "video/mp4" ? "MP4" : "WebM"} · {humanSize(take.bytes)}
                  </div>
                </div>
                <button
                  disabled={busyId !== null}
                  onClick={() => void downloadTake(take)}
                  style={{
                    flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    padding: "5px 12px",
                    cursor: busyId ? "wait" : "pointer",
                    fontSize: 12.5,
                    touchAction: "manipulation",
                  }}
                >
                  {busyId === take.id ? "Decrypting…" : "Download video"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
