import { useEffect, useRef, useState } from "react";
import { useEditor, useValue } from "tldraw";
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
} from "@tldraw/tlschema";
import { accent, glass, text } from "../ui/tokens";
import { exportBoardPdf, exportCurrentPagePng } from "./export";
import {
  ArrowIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EraserIcon,
  MathIcon,
  PaintIcon,
  PenIcon,
  RedoIcon,
  SelectIcon,
  ShapeIcon,
  TextIcon,
  UndoIcon,
} from "./icons";

// Native tldraw tools get full, battle-tested drag interactions for free.
// 'arrow' is tldraw's own arrow; shapes use tldraw's 'geo' tool with the
// dash style set to 'draw' for a hand-drawn look and the kind selected by
// the Shape button.
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

const INK_COLORS = ["black", "red", "blue", "green", "violet"] as const;
const INK_SIZES = ["s", "m", "l"] as const;

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

const popoverStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 56,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1200,
  background: glass.surface,
  backdropFilter: glass.blur,
  WebkitBackdropFilter: glass.blur,
  border: `1px solid ${glass.border}`,
  borderRadius: 14,
  boxShadow: glass.shadow,
  padding: 10,
  display: "flex",
  alignItems: "center",
  gap: 10,
  touchAction: "manipulation",
};

/**
 * Drawing toolbar for the board device (the iPad or any pen-capable
 * tablet/phone). The recording UI lives in RecordingControls on the capture
 * device. Everything here is device-agnostic input: pen, stylus, finger and
 * mouse all draw with tldraw's native tools.
 */
export function AppToolbar() {
  const editor = useEditor();
  const currentToolId = useValue("current tool", () => editor.getCurrentToolId(), [editor]);
  const pages = useValue("pages", () => editor.getPages(), [editor]);
  const pageId = useValue("page id", () => editor.getCurrentPageId(), [editor]);
  const selectedCount = useValue(
    "selection count",
    () => editor.getSelectedShapeIds().length,
    [editor],
  );

  const pageIndex = Math.max(0, pages.findIndex((p) => p.id === pageId));
  const pageNumber = pageIndex + 1;

  // Shape button cycles rectangle -> ellipse -> line.
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  const shapeActive =
    (shapeKind === "line" && currentToolId === "line") ||
    (shapeKind !== "line" && currentToolId === "geo");

  // Style + rename + export popovers.
  const [styleOpen, setStyleOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const msgTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  function flash(message: string) {
    setExportMsg(message);
    if (msgTimer.current !== undefined) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setExportMsg(null), 4000);
  }

  function pickShape(kind: ShapeKind) {
    setShapeKind(kind);
    // One consistent "teacher marker on a board" look for shapes and lines.
    applyInkDefaults();
    if (kind === "line") {
      editor.setCurrentTool("line");
    } else {
      editor.setStyleForNextShapes(GeoShapeGeoStyle, kind);
      editor.setCurrentTool("geo");
    }
  }

  function applyInkDefaults() {
    editor.setStyleForNextShapes(DefaultColorStyle, "black");
    editor.setStyleForNextShapes(DefaultSizeStyle, "m");
    editor.setStyleForNextShapes(DefaultDashStyle, "draw");
    editor.setStyleForNextShapes(DefaultFillStyle, "none");
  }

  function armTool(id: string) {
    if (id === "draw" || id === "arrow") applyInkDefaults();
    editor.setCurrentTool(id);
  }

  function cycleShape() {
    const index = SHAPE_CYCLE.indexOf(shapeKind);
    pickShape(SHAPE_CYCLE[(index + 1) % SHAPE_CYCLE.length]!);
  }

  function goPage(nextIndex: number) {
    const target = pages[nextIndex];
    if (target) {
      editor.setCurrentPage(target.id);
    } else {
      editor.createPage({ name: `Page ${pages.length + 1}` });
      // New page becomes current automatically.
    }
  }

  function startRename() {
    const page = editor.getCurrentPage();
    setRenameDraft(page?.name ?? "");
    setRenaming(true);
  }

  function commitRename() {
    const name = renameDraft.trim();
    if (name) {
      const page = editor.getCurrentPage();
      if (page) editor.renamePage(page.id, name);
    }
    setRenaming(false);
  }

  function applyColor(color: (typeof INK_COLORS)[number]) {
    if (selectedCount > 0) editor.setStyleForSelectedShapes(DefaultColorStyle, color);
    else editor.setStyleForNextShapes(DefaultColorStyle, color);
    setStyleOpen(false);
  }

  function applySize(size: (typeof INK_SIZES)[number]) {
    if (selectedCount > 0) editor.setStyleForSelectedShapes(DefaultSizeStyle, size);
    else editor.setStyleForNextShapes(DefaultSizeStyle, size);
    setStyleOpen(false);
  }

  async function runExport(kind: "png" | "pdf") {
    try {
      flash(kind === "png" ? await exportCurrentPagePng(editor) : await exportBoardPdf(editor));
    } catch (err) {
      flash(`Export failed: ${err instanceof Error ? err.message : "unknown error"}`);
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
        // individually. This toolbar is injected into that same tree and must
        // re-enable them explicitly.
        pointerEvents: "auto",
      }}
    >
      {exportMsg && (
        <div
          role="status"
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            font: "500 12.5px/1.3 system-ui, sans-serif",
            color: "#fff",
            background: "rgba(20, 20, 22, 0.92)",
            border: "1px solid rgba(255,255,255,0.15)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {exportMsg}
        </div>
      )}

      {styleOpen && (
        <div style={popoverStyle}>
          {INK_COLORS.map((color) => (
            <button
              key={color}
              title={`${color} ink`}
              aria-label={`${color} ink`}
              onClick={() => applyColor(color)}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.25)",
                background: color === "black" ? "#1a1a1a" : color,
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            />
          ))}
          <div style={dividerStyle} />
          {INK_SIZES.map((size) => (
            <button
              key={size}
              title={`${size} width`}
              aria-label={`${size} width`}
              onClick={() => applySize(size)}
              style={{
                width: 30,
                height: 26,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#fff",
                font: "600 11px system-ui, sans-serif",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                touchAction: "manipulation",
              }}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          background: glass.surface,
          backdropFilter: glass.blur,
          WebkitBackdropFilter: glass.blur,
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
            onClick={() => armTool(id)}
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
          title={selectedCount > 0 ? "Style selected shapes" : "Ink colour / width"}
          aria-label="Ink colour and width"
          style={iconButtonStyle(styleOpen)}
          onClick={() => setStyleOpen((open) => !open)}
        >
          <PaintIcon width={19} height={19} />
        </button>

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

        <div style={dividerStyle} />

        <button
          title="Previous page"
          aria-label="Previous page"
          style={iconButtonStyle(pageIndex > 0)}
          onClick={() => goPage(pageIndex - 1)}
        >
          <ChevronLeftIcon width={17} height={17} />
        </button>
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            style={{
              width: 96,
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              background: "rgba(0,0,0,0.3)",
              color: "#fff",
              padding: "4px 8px",
              fontSize: 12,
              outline: "none",
              fontFamily: "system-ui, sans-serif",
              touchAction: "manipulation",
            }}
          />
        ) : (
          <button
            title="Rename this page"
            aria-label="Rename page"
            style={{
              ...iconButtonStyle(),
              width: "auto",
              minWidth: 54,
              maxWidth: 150,
              padding: "0 10px",
              font: "600 12px system-ui, sans-serif",
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            onClick={startRename}
          >
            {pageNumber}/{pages.length} · {pages[pageIndex]?.name}
          </button>
        )}
        <button
          title="Next page (creates one at the end)"
          aria-label="Next page"
          style={iconButtonStyle(pageIndex < pages.length - 1)}
          onClick={() => goPage(pageIndex + 1)}
        >
          <ChevronRightIcon width={17} height={17} />
        </button>
        <button
          title="Export (PNG page / PDF board)"
          aria-label="Export"
          style={iconButtonStyle()}
          onClick={() => void runExport("png")}
          onContextMenu={(e) => {
            e.preventDefault();
            void runExport("pdf");
          }}
        >
          <DownloadIcon width={17} height={17} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: text.dim, opacity: 0.8 }}>
        right-click/tap-hold export for PDF · style applies to selection
      </div>
    </div>
  );
}
