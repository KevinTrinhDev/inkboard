import type { PreflightState } from "./useRecordingRig";
import { glass, status, text } from "../ui/tokens";

// serverConnected is intentionally NOT in this list: it's shown separately
// below as informational only, because recording is offline-first.
// Of the four below, camera/mic/disk gate REC; pencilReady is shown for
// information only (it describes the iPad, not the capture device). See
// useRecordingRig.ts.
const ITEMS: Array<[key: keyof PreflightState, label: string]> = [
  ["pencilReady", "Pencil"],
  ["cameraReady", "Camera"],
  // micReady, not micActive: the dot tracks what actually gates REC, which
  // is "the mic has worked at least once", not "you are talking right now".
  ["micReady", "Mic"],
  ["diskOk", "Disk"],
];

const dotStyle = (color: string): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: color,
  flexShrink: 0,
});

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

/** Compact status row: a colored dot per signal, no text-heavy checkmarks. */
export function PreflightChecklist({
  preflight,
  pendingSyncCount,
}: {
  preflight: PreflightState;
  pendingSyncCount: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "center",
        fontFamily: "system-ui, sans-serif",
        fontSize: 11.5,
        color: text.dim,
        letterSpacing: 0.1,
      }}
    >
      {ITEMS.map(([key, label]) => {
        const ok = preflight[key];
        return (
          <span key={key} style={itemStyle}>
            <span style={dotStyle(ok ? status.ok : status.pending)} />
            <span style={{ color: ok ? text.onDim : text.dim }}>{label}</span>
          </span>
        );
      })}

      <span style={{ width: 1, height: 12, background: glass.divider }} />

      <span style={itemStyle}>
        <span style={dotStyle(preflight.serverConnected ? status.ok : status.warn)} />
        <span style={{ color: preflight.serverConnected ? text.onDim : text.dim }}>
          {preflight.serverConnected ? "Online" : "Offline"}
        </span>
      </span>

      {pendingSyncCount > 0 && (
        <span style={{ color: status.warn }}>{pendingSyncCount} waiting to sync</span>
      )}
    </div>
  );
}
