import { useEditor, useValue } from "tldraw";
import { useRecordingContext } from "../recording/RecordingContext";
import { PreflightChecklist } from "../recording/PreflightChecklist";
import { accent, glass, text } from "../ui/tokens";
import {
  ArrowIcon,
  EraserIcon,
  EyeIcon,
  EyeOffIcon,
  MathIcon,
  PageIcon,
  PenIcon,
  RecordIcon,
  RedoIcon,
  SelectIcon,
  ShapeIcon,
  StopIcon,
  TextIcon,
  UndoIcon,
} from "./icons";

const TOOLS: Array<[id: string, label: string, Icon: typeof SelectIcon]> = [
  ["select", "Select", SelectIcon],
  ["draw", "Pen", PenIcon],
  ["eraser", "Eraser", EraserIcon],
  ["inkboard-text", "Text", TextIcon],
  ["inkboard-math", "Math", MathIcon],
  ["inkboard-arrow", "Arrow", ArrowIcon],
  ["inkboard-shape", "Shape", ShapeIcon],
];

const iconButtonStyle = (active = false): React.CSSProperties => ({
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: active ? accent.active : "transparent",
  color: active ? text.active : text.muted,
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  transition: "background 0.12s ease, color 0.12s ease",
  // This toolbar renders inside tldraw's own component tree, which sits
  // inside BoardCanvas's touch-action:none drawing surface. Without this,
  // WebKit's documented touch-action:none-suppresses-tap quirk can make
  // these buttons stop responding to taps entirely on iPadOS Safari.
  touchAction: "manipulation",
});

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  margin: "6px 4px",
  background: glass.divider,
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/**
 * Icon-only toolbar, minimal premium chrome replacing default tldraw UI
 * (see BoardCanvas.tsx's `components` override). Tooltips carry the label
 * text via `title` so nothing is lost for accessibility/discoverability;
 * the visual surface stays quiet on purpose.
 */
export function AppToolbar() {
  const editor = useEditor();
  const currentToolId = useValue("current tool", () => editor.getCurrentToolId(), [editor]);
  const rig = useRecordingContext();

  function nextOrNewPage() {
    const pages = editor.getPages();
    const currentIndex = pages.findIndex((page) => page.id === editor.getCurrentPageId());
    const next = pages[currentIndex + 1];
    if (next) {
      editor.setCurrentPage(next);
    } else {
      editor.createPage({ name: `Page ${pages.length + 1}` });
    }
  }

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
        {TOOLS.map(([id, label, Icon]) => (
          <button
            key={id}
            title={label}
            aria-label={label}
            style={iconButtonStyle(currentToolId === id)}
            onClick={() => editor.setCurrentTool(id)}
          >
            <Icon width={19} height={19} />
          </button>
        ))}

        <div style={dividerStyle} />

        <button
          title="Undo"
          aria-label="Undo"
          style={iconButtonStyle()}
          onClick={() => editor.undo()}
        >
          <UndoIcon width={19} height={19} />
        </button>
        <button
          title="Redo"
          aria-label="Redo"
          style={iconButtonStyle()}
          onClick={() => editor.redo()}
        >
          <RedoIcon width={19} height={19} />
        </button>
        <button
          title="New / next page"
          aria-label="New or next page"
          style={iconButtonStyle()}
          onClick={nextOrNewPage}
        >
          <PageIcon width={19} height={19} />
        </button>
        <button
          title={rig.previewVisible ? "Hide camera preview" : "Show camera preview"}
          aria-label={rig.previewVisible ? "Hide camera preview" : "Show camera preview"}
          style={iconButtonStyle(rig.previewVisible)}
          onClick={rig.togglePreview}
        >
          {rig.previewVisible ? (
            <EyeIcon width={19} height={19} />
          ) : (
            <EyeOffIcon width={19} height={19} />
          )}
        </button>

        <div style={dividerStyle} />

        <button
          title={rig.isRecording ? "Stop recording" : "Start recording"}
          aria-label={rig.isRecording ? "Stop recording" : "Start recording"}
          style={{
            ...iconButtonStyle(),
            color: rig.isRecording ? text.active : accent.record,
            background: rig.isRecording ? accent.record : "transparent",
            opacity: !rig.isRecording && !rig.readyToRecord ? 0.35 : 1,
            cursor: !rig.isRecording && !rig.readyToRecord ? "not-allowed" : "pointer",
          }}
          disabled={!rig.isRecording && !rig.readyToRecord}
          onClick={rig.toggleRecording}
        >
          {rig.isRecording ? <StopIcon width={16} height={16} /> : <RecordIcon width={16} height={16} />}
        </button>
      </div>
    </div>
  );
}
