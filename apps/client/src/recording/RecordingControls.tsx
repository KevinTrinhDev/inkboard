import { EyeIcon, EyeOffIcon, RecordIcon, StopIcon } from "../board/icons";
import { PreflightChecklist } from "./PreflightChecklist";
import { MyTakesButton } from "./MyTakes";
import { useRecordingContext } from "./RecordingContext";
import { accent, glass, text } from "../ui/tokens";

/**
 * The record button, pre-flight row and camera controls, for the device that
 * owns the camera and mic.
 *
 * These used to live inside AppToolbar, which is a tldraw `components.Toolbar`
 * override. The mirror deliberately renders no toolbar (BoardCanvas's
 * `mirrorComponents` sets `Toolbar: null`, because the mirror is a window
 * onto the iPad and not a second place to work), so on the laptop - the only
 * device that ever calls getUserMedia - there was no record button at all.
 * Meanwhile the iPad had the button but never has a stream, so its REC stayed
 * disabled forever. The result was a product that could not record on any
 * device.
 *
 * Rendering this from AppShell instead makes the recording UI independent of
 * the editor's chrome, which is the right coupling: recording belongs to the
 * capture device, drawing tools belong to the board.
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

const buttonStyle = (active = false): React.CSSProperties => ({
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: active ? accent.active : "transparent",
  color: active ? text.active : text.muted,
  border: active ? `1.5px solid ${accent.activeRing}` : "1.5px solid transparent",
  borderRadius: 10,
  cursor: "pointer",
  touchAction: "manipulation",
});

export function RecordingControls() {
  const rig = useRecordingContext();

  // Only the capture device shows these. On the iPad they would be a row of
  // permanently grey dots and a button that can never do anything.
  if (!rig.capture) return null;

  const blocked = !rig.isRecording && !rig.readyToRecord;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        touchAction: "manipulation",
      }}
    >
      {rig.cameraError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "min(90vw, 460px)",
            background: "rgba(180, 32, 32, 0.94)",
            color: "#fff",
            font: "500 12.5px/1.4 system-ui, sans-serif",
            padding: "8px 12px",
            borderRadius: 10,
          }}
        >
          <span>{rig.cameraError}</span>
          <button
            onClick={rig.retryCamera}
            style={{
              flexShrink: 0,
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: 8,
              padding: "4px 10px",
              cursor: "pointer",
              font: "600 12px system-ui, sans-serif",
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: glass.surface,
          backdropFilter: glass.blur,
          padding: "6px 14px",
          borderRadius: 999,
          border: `1px solid ${glass.border}`,
        }}
      >
        <PreflightChecklist preflight={rig.preflight} pendingSyncCount={rig.pendingSyncCount} />
        {rig.isRecording && (
          <>
            <span style={{ width: 1, height: 12, background: glass.divider }} />
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: accent.record,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatElapsed(rig.elapsedMs)}
            </span>
          </>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          background: glass.surface,
          backdropFilter: glass.blur,
          padding: 6,
          borderRadius: 18,
          border: `1px solid ${glass.border}`,
          boxShadow: glass.shadow,
        }}
      >
        <button
          title={rig.previewVisible ? "Hide camera preview" : "Show camera preview"}
          aria-label={rig.previewVisible ? "Hide camera preview" : "Show camera preview"}
          style={buttonStyle(rig.previewVisible)}
          onClick={rig.togglePreview}
        >
          {rig.previewVisible ? <EyeIcon width={19} height={19} /> : <EyeOffIcon width={19} height={19} />}
        </button>

        <div style={{ width: 1, alignSelf: "stretch", margin: "6px 4px", background: glass.divider }} />

        <MyTakesButton />

        <div style={{ width: 1, alignSelf: "stretch", margin: "6px 4px", background: glass.divider }} />

        <button
          title={
            rig.isRecording
              ? "Stop recording"
              : blocked
                ? "Waiting for camera, mic and disk space"
                : "Start recording"
          }
          aria-label={rig.isRecording ? "Stop recording" : "Start recording"}
          style={{
            ...buttonStyle(),
            color: rig.isRecording ? text.active : accent.record,
            background: rig.isRecording ? accent.record : "transparent",
            opacity: blocked ? 0.35 : 1,
            cursor: blocked ? "not-allowed" : "pointer",
          }}
          disabled={blocked}
          onClick={rig.toggleRecording}
        >
          {rig.isRecording ? <StopIcon width={16} height={16} /> : <RecordIcon width={16} height={16} />}
        </button>
      </div>
    </div>
  );
}
