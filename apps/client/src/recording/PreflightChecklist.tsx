import type { PreflightState } from "./useRecordingRig";

// serverConnected is intentionally NOT in this list — it's shown separately
// below as informational only. Recording is offline-first: none of these
// five gate REC, only pencil/camera/mic/disk do. See useRecordingRig.ts.
const ITEMS: Array<[key: keyof PreflightState, label: string]> = [
  ["pencilReady", "Pencil ready"],
  ["cameraReady", "Camera detected"],
  ["micActive", "Mic level moving"],
  ["diskOk", "Disk space"],
];

/** The boring, literal checklist from the original spec — nothing fancy. */
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
        gap: 12,
        flexWrap: "wrap",
        alignItems: "center",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
      }}
    >
      {ITEMS.map(([key, label]) => {
        const ok = preflight[key];
        return (
          <span key={key} style={{ color: ok ? "#4ade80" : "#888" }}>
            {ok ? "✓" : "○"} {label}
          </span>
        );
      })}
      <span style={{ color: preflight.serverConnected ? "#4ade80" : "#facc15" }}>
        {preflight.serverConnected ? "● Online" : "○ Offline — recording still works"}
      </span>
      {pendingSyncCount > 0 && (
        <span style={{ color: "#facc15" }}>
          ⏳ {pendingSyncCount} waiting to sync
        </span>
      )}
    </div>
  );
}
