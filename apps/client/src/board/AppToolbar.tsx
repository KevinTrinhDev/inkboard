import { useEditor, useValue } from "tldraw";
import { useRecordingContext } from "../recording/RecordingContext";
import { PreflightChecklist } from "../recording/PreflightChecklist";

const TOOLS: Array<[id: string, label: string]> = [
  ["select", "Select"],
  ["draw", "Pen"],
  ["eraser", "Eraser"],
  ["inkboard-text", "Text"],
  ["inkboard-math", "Math"],
  ["inkboard-arrow", "Arrow"],
  ["inkboard-shape", "Shape"],
];

const buttonStyle = (active = false): React.CSSProperties => ({
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "system-ui, sans-serif",
  background: active ? "#3b3b3b" : "transparent",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 6,
  cursor: "pointer",
});

/**
 * The purpose-built, boring toolbar from the original spec — replaces
 * default tldraw UI entirely (see BoardCanvas.tsx's `components` override).
 * Pen/Eraser/Undo/Redo/Page/REC, plus the pre-flight checklist gating REC.
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
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          background: "#1a1a1aee",
          padding: "6px 10px",
          borderRadius: 10,
        }}
      >
        <PreflightChecklist preflight={rig.preflight} pendingSyncCount={rig.pendingSyncCount} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          background: "#1a1a1aee",
          padding: 8,
          borderRadius: 12,
        }}
      >
        {TOOLS.map(([id, label]) => (
          <button
            key={id}
            style={buttonStyle(currentToolId === id)}
            onClick={() => editor.setCurrentTool(id)}
          >
            {label}
          </button>
        ))}
        <button style={buttonStyle()} onClick={() => editor.undo()}>
          Undo
        </button>
        <button style={buttonStyle()} onClick={() => editor.redo()}>
          Redo
        </button>
        <button style={buttonStyle()} onClick={nextOrNewPage}>
          Page
        </button>
        <button
          style={{
            ...buttonStyle(),
            background: rig.isRecording ? "#dc2626" : "transparent",
            borderColor: rig.isRecording ? "#dc2626" : "#444",
            opacity: !rig.isRecording && !rig.readyToRecord ? 0.4 : 1,
            cursor: !rig.isRecording && !rig.readyToRecord ? "not-allowed" : "pointer",
          }}
          disabled={!rig.isRecording && !rig.readyToRecord}
          onClick={rig.toggleRecording}
        >
          {rig.isRecording ? "■ Stop" : "● REC"}
        </button>
      </div>
    </div>
  );
}
