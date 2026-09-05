import { useState } from "react";
import { useEditor, useValue } from "tldraw";
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
} from "@tldraw/tlschema";
import { accent, glass, text } from "../ui/tokens";
import {
  ArrowIcon,
  EraserIcon,
  MathIcon,
  PageIcon,
  PenIcon,
  RedoIcon,
  SelectIcon,
  ShapeIcon,
  TextIcon,
  UndoIcon,
} from "./icons";

// Native tldraw tools get full, battle-tested drag interactions for free.
// 'arrow' is tldraw's own arrow (drag from tail to head, arrowhead, optional
// label); shapes use tldraw's 'geo' tool with the dash style set to 'draw'
// for a hand-drawn look, with the kind selected by the Shape button below.
const TOOLS: Array<[id: string, label: string, Icon: typeof SelectIcon]> = [
  ["select", "Select", SelectIcon],
  ["draw", "Pen", PenIcon],
  ["eraser", "Eraser", EraserIcon],
  ["inkboard-text", "Text", TextIcon],
  ["inkboard-math", "Math", MathIcon],
  ["arrow", "Arrow", ArrowIcon],
];

type ShapeKind = "rectangle" | "ellipse" | "line";
const SHAPE_CYCLE: ShapeKind[] = ["rectangle", "ellipse", "line"];

const iconButtonStyle = (active = false): React.CSSProperties => ({
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: active ? accent.active : "transparent",
  color: active ? text.active : text.muted,
  // A real border, not just a background tint, so the active tool is
  // unmistakable in bright light, not just a subtle 14% overlay.
  border: active ? `1.5px solid ${accent.activeRing}` : "1.5px solid transparent",
  borderRadius: 10,
  cursor: "pointer",
  transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
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

/**
 * Icon-only drawing toolbar, minimal premium chrome replacing default tldraw
 * UI (see BoardCanvas.tsx's `components` override). Tooltips carry the label
 * text via `title` so nothing is lost for accessibility/discoverability;
 * the visual surface stays quiet on purpose.
 *
 * Drawing tools only. The record button, pre-flight row and camera preview
 * toggle used to live here, but this component is only rendered for the
 * editor role (the mirror sets `Toolbar: null`), and the editor is the iPad,
 * which never holds the camera. They now live in RecordingControls, rendered
 * from AppShell on the capture device.
 */
export function AppToolbar() {
  const editor = useEditor();
  const currentToolId = useValue("current tool", () => editor.getCurrentToolId(), [editor]);

  // What the Shape button will draw next. Tapping the button cycles
  // rectangle -> ellipse -> line and immediately arms the matching native
  // tool ('geo' with the dash style set to 'draw' for a hand-drawn look, or
  // tldraw's 'line' tool).
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  const shapeActive =
    (shapeKind === "line" && currentToolId === "line") ||
    (shapeKind !== "line" && currentToolId === "geo");

  function pickShape(kind: ShapeKind) {
    setShapeKind(kind);
    // One consistent "teacher marker on a board" look for every shape and
    // line: dark ink, medium weight, hand-drawn ('draw') edges.
    editor.setStyleForNextShapes(DefaultColorStyle, "black");
    editor.setStyleForNextShapes(DefaultSizeStyle, "m");
    editor.setStyleForNextShapes(DefaultDashStyle, "draw");
    if (kind === "line") {
      editor.setCurrentTool("line");
    } else {
      editor.setStyleForNextShapes(GeoShapeGeoStyle, kind);
      editor.setStyleForNextShapes(DefaultFillStyle, "none");
      editor.setCurrentTool("geo");
    }
  }

  function cycleShape() {
    const index = SHAPE_CYCLE.indexOf(shapeKind);
    pickShape(SHAPE_CYCLE[(index + 1) % SHAPE_CYCLE.length]!);
  }

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
        // tldraw's own chrome lives inside `.tlui-layout`, which sets
        // `pointer-events: none` so that clicks fall through to the canvas,
        // and re-enables `pointer-events: all` on each of its UI elements
        // individually. This toolbar is injected into that same tree via
        // `components.Toolbar` but never re-enabled them, so it inherited
        // `none`: every button here was painted correctly and was completely
        // inert. `document.elementFromPoint()` over the Pen button returned
        // `.tl-background`, and neither a real mouse click nor a real touch
        // tap could change tools, undo, redo or add a page on the iPad.
        pointerEvents: "auto",
      }}
    >
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

        <button
          title={`Shape (next: ${shapeKind})`}
          aria-label="Shape (rectangle, ellipse or line)"
          style={iconButtonStyle(shapeActive)}
          onClick={cycleShape}
        >
          <ShapeIcon width={19} height={19} />
        </button>

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
      </div>
    </div>
  );
}
