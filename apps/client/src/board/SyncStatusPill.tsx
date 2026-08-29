import type { SyncStatus } from "./useBoardSync";
import { glass, text } from "../ui/tokens";

const LABEL: Record<SyncStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  offline: "Reconnecting",
};

const DOT: Record<SyncStatus, string> = {
  connecting: "#eab308",
  live: "#22c55e",
  offline: "#ef4444",
};

/**
 * Small, always-visible truth about whether the two devices are actually
 * talking. Silence is the failure mode that matters here: a mirror that has
 * quietly stopped updating looks identical to a board nobody is drawing on.
 */
export function SyncStatusPill({
  status,
  peers,
  role,
}: {
  status: SyncStatus;
  peers: number;
  role: "editor" | "mirror";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        font: "500 12px/1 system-ui, -apple-system, sans-serif",
        color: text.onDim,
        background: glass.surface,
        border: `1px solid ${glass.border}`,
        backdropFilter: glass.blur,
        WebkitBackdropFilter: glass.blur,
        boxShadow: glass.shadow,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: DOT[status],
          boxShadow: status === "live" ? `0 0 8px ${DOT[status]}` : "none",
        }}
      />
      <span>{role === "mirror" ? "Mirror" : "Board"}</span>
      <span style={{ opacity: 0.55 }}>{LABEL[status]}</span>
      {status === "live" && peers > 1 && (
        <span style={{ opacity: 0.55 }}>{peers} devices</span>
      )}
    </div>
  );
}
