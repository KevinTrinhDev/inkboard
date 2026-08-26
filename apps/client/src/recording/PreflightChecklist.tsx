import type { PreflightState } from "./useRecordingRig";

// serverConnected is intentionally NOT in this list — it's shown separately
// below as informational only. Recording is offline-first: none of these
// five gate REC, only pencil/camera/mic/disk do. See useRecordingRig.ts.
const ITEMS: Array<[key: keyof PreflightState, label: string]> = [
  ["pencilReady", "Pencil"],
  ["cameraReady", "Camera"],
  ["micActive", "Mic"],
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

const OK = "#4ade80";
const PENDING = "#4a4a4d";
const WARN = "#facc15";

/** Compact status row — a colored dot per signal, no text-heavy checkmarks. */
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
        color: "#a1a1a6",
        letterSpacing: 0.1,
      }}
    >
      {ITEMS.map(([key, label]) => {
        const ok = preflight[key];
        return (
          <span key={key} style={itemStyle}>
            <span style={dotStyle(ok ? OK : PENDING)} />
            <span style={{ color: ok ? "#e8e8ea" : "#a1a1a6" }}>{label}</span>
          </span>
        );
      })}

      <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.1)" }} />

      <span style={itemStyle}>
        <span style={dotStyle(preflight.serverConnected ? OK : WARN)} />
        <span style={{ color: preflight.serverConnected ? "#e8e8ea" : "#a1a1a6" }}>
          {preflight.serverConnected ? "Online" : "Offline"}
        </span>
      </span>

      {pendingSyncCount > 0 && (
        <span style={{ color: WARN }}>{pendingSyncCount} waiting to sync</span>
      )}
    </div>
  );
}
