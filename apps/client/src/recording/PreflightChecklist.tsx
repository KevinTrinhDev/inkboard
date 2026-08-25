import type { PreflightState } from "./useRecordingRig";

const ITEMS: Array<[key: keyof PreflightState, label: string]> = [
  ["pencilReady", "Pencil ready"],
  ["cameraReady", "Camera detected"],
  ["micActive", "Mic level moving"],
  ["serverConnected", "Server connected"],
  ["diskOk", "Disk space"],
];

/** The boring, literal checklist from the original spec — nothing fancy. */
export function PreflightChecklist({ preflight }: { preflight: PreflightState }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
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
    </div>
  );
}
