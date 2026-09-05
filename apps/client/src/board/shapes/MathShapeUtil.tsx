import { useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  useValue,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";

export type MathShape = TLBaseShape<
  "inkboard-math",
  { w: number; h: number; latex: string }
>;

// KaTeX (and its CSS) is only loaded once a Math object actually exists on
// the board, not on every page load: dynamic import, cached after first use.
let katexModulePromise: Promise<typeof import("katex")> | null = null;
function loadKatex() {
  katexModulePromise ??= import("katex").then(async (mod) => {
    await import("katex/dist/katex.min.css");
    return mod;
  });
  return katexModulePromise;
}

/**
 * Live KaTeX preview of a latex string. Invalid latex is shown as its raw
 * monospace text rather than nothing, so the operator can see what failed;
 * a blank string shows a faint π hint instead of an empty box.
 */
function LatexPreview({ latex, fontSize = 22 }: { latex: string; fontSize?: number }) {
  const [html, setHtml] = useState<string>("");
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const { default: katex } = await loadKatex();
      if (cancelled) return;
      try {
        setHtml(katex.renderToString(latex, { throwOnError: true }));
        setBroken(false);
      } catch {
        setBroken(true);
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [latex]);

  if (!latex.trim()) {
    return <span style={{ opacity: 0.45, fontSize }}>{"\u03c0"}</span>;
  }
  if (broken) {
    return (
      <span style={{ opacity: 0.6, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
        {latex}
      </span>
    );
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} style={{ opacity: 1 }} />;
}

/**
 * Semantic math: content is LaTeX rendered with KaTeX — never typed in the
 * handwriting font (legibility of x/2/z matters more than stylistic
 * consistency, see docs/ARCHITECTURE.md). Editing mirrors the text shape:
 * the Math tool places a shape and opens a small LaTeX entry panel with a
 * live KaTeX preview; existing equations edit via the ✎ affordance or a
 * double tap. Enter/blur commits, Escape discards, an empty commit deletes
 * the shape. Committed latex is always renderable.
 */
export class MathShapeUtil extends BaseBoxShapeUtil<MathShape> {
  static override type = "inkboard-math" as const;
  static override props: RecordProps<MathShape> = {
    w: T.number,
    h: T.number,
    latex: T.string,
  };

  getDefaultProps(): MathShape["props"] {
    return { w: 200, h: 64, latex: "" };
  }

  component(shape: MathShape) {
    return <MathShapeBody shape={shape} />;
  }

  /** tldraw only lets shapes edit in place when the util says it can. */
  override canEdit(): boolean {
    return true;
  }

  indicator(shape: MathShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

function MathShapeBody({ shape }: { shape: MathShape }) {
  const editor = useEditor();
  const isEditing = useValue(
    "is editing math",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );
  const isSelected = useValue(
    "is math selected",
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );
  const isReadonly = useValue(
    "is board readonly",
    () => editor.getInstanceState().isReadonly,
    [editor],
  );

  const [draft, setDraft] = useState(shape.props.latex);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(shape.props.latex);
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [isEditing, shape.id]);

  const commit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      editor.deleteShapes([shape.id]);
    } else {
      editor.updateShape<MathShape>({
        id: shape.id,
        type: "inkboard-math",
        props: { latex: trimmed },
      });
    }
    editor.setEditingShape(null);
  };

  const canInteract = isSelected && !isReadonly;

  // Read-only mirror or plain display state: pure preview, no affordances
  // that could steal pointer events from the canvas.
  if (isReadonly || !isEditing) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: canInteract ? "auto" : "none",
        }}
      >
        <div
          onDoubleClick={(e) => {
            if (!canInteract) return;
            e.preventDefault();
            e.stopPropagation();
            editor.setEditingShape(shape.id);
          }}
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: 4,
            color: "#1a1a1a",
            cursor: "text",
            touchAction: "manipulation",
          }}
        >
          <LatexPreview latex={shape.props.latex} />
        </div>
        {canInteract && (
          <button
            title="Edit equation"
            aria-label="Edit equation"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              editor.setEditingShape(shape.id);
            }}
            style={{
              position: "absolute",
              right: 6,
              top: 6,
              width: 26,
              height: 26,
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "rgba(255,255,255,0.9)",
              color: "#444",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              lineHeight: 1,
              touchAction: "manipulation",
            }}
          >
            ✎
          </button>
        )}
      </HTMLContainer>
    );
  }

  // Editing: a floating LaTeX entry panel under the shape with a live KaTeX
  // preview, so what lands on the board is always a valid equation. The
  // panel may overflow the shape bounds; .tl-html-container does not clip.
  const cardWidth = Math.max(320, Math.min(440, shape.props.w + 120));
  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "none" }}
    >
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          width: cardWidth,
          pointerEvents: "auto",
          touchAction: "manipulation",
          zIndex: 100,
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.98)",
            border: "1px solid rgba(91,141,255,0.7)",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            padding: 8,
          }}
        >
          <textarea
            ref={areaRef}
            value={draft}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={"LaTeX, e.g.  F = ma   or   \\frac{a}{b}"}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                editor.setEditingShape(null); // discard: no change applied
              }
            }}
            onBlur={() => commit(draft)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 15,
              padding: "2px 2px 6px",
              margin: 0,
              resize: "none",
              overflow: "hidden",
              touchAction: "manipulation",
            }}
          />
          <div
            style={{
              borderTop: "1px solid rgba(0,0,0,0.08)",
              padding: "6px 2px 2px",
              minHeight: 36,
              display: "flex",
              alignItems: "center",
              color: "#1a1a1a",
            }}
          >
            <LatexPreview latex={draft} fontSize={20} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                editor.setEditingShape(null); // discard
              }}
              style={cardButtonStyle}
            >
              Discard
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                commit(draft);
              }}
              style={{ ...cardButtonStyle, background: "#5b8dff", color: "#fff" }}
            >
              ✓ Done
            </button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", margin: "3px 2px" }}>
          Enter = done · Esc = discard
        </div>
      </div>
    </HTMLContainer>
  );
}

const cardButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.2)",
  borderRadius: 8,
  padding: "4px 12px",
  background: "#fff",
  color: "#333",
  fontSize: 13,
  cursor: "pointer",
  touchAction: "manipulation",
};
