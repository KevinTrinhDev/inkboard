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

export type TextShape = TLBaseShape<
  "inkboard-text",
  { w: number; h: number; content: string; lang: string }
>;

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 900;
const LINE_PAD = 10;

/**
 * Editable, semantic text. The content is a plain string (never rich-text
 * markup), because that is exactly what the typed TEXT object in
 * packages/shared-schema stores and what translation/search will later read.
 *
 * Editing model (tldraw 3): `editor.setEditingShape(id)` flips this util into
 * its editing render, which shows a real <textarea> filling the shape bounds.
 * Two ways in: the Text tool places a shape and immediately opens editing
 * (pencil-first: tap the tool, tap the board, type), and a selected text
 * shape shows a small ✎ affordance (plus double-tap) to edit an existing
 * one. Every keystroke commits straight into `props.content`, so it syncs to
 * the mirror and survives the offline persistence layer like any other edit.
 */
export class TextShapeUtil extends BaseBoxShapeUtil<TextShape> {
  static override type = "inkboard-text" as const;
  static override props: RecordProps<TextShape> = {
    w: T.number,
    h: T.number,
    content: T.string,
    lang: T.string,
  };

  getDefaultProps(): TextShape["props"] {
    return { w: 240, h: MIN_HEIGHT, content: "", lang: "en" };
  }

  component(shape: TextShape) {
    return <EditableText shape={shape} />;
  }

  /** tldraw only lets shapes edit in place when the util says it can. */
  override canEdit(): boolean {
    return true;
  }

  indicator(shape: TextShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

function EditableText({ shape }: { shape: TextShape }) {
  const editor = useEditor();
  const isEditing = useValue(
    "is editing text",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );
  const isSelected = useValue(
    "is text selected",
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );
  const isReadonly = useValue(
    "is board readonly",
    () => editor.getInstanceState().isReadonly,
    [editor],
  );

  const [draft, setDraft] = useState(shape.props.content);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-seed the draft whenever this shape starts being edited (a fresh edit
  // always begins from the committed content).
  useEffect(() => {
    if (isEditing) {
      setDraft(shape.props.content);
      // Focus as soon as the overlay mounts so the keyboard opens on iPad.
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [isEditing, shape.id]);

  if (isReadonly || (!isEditing && !isSelected)) {
    // Read-only mirror, or a shape nobody is interacting with: pure text,
    // no affordances, never intercepting pointer events meant for the
    // canvas.
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 22,
            lineHeight: 1.25,
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: 4,
            color: "#1a1a1a",
            pointerEvents: "none",
          }}
        >
          {shape.props.content || "\u00a0"}
        </div>
      </HTMLContainer>
    );
  }

  if (!isEditing) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: isSelected ? "auto" : "none",
        }}
      >
        <div
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            editor.setEditingShape(shape.id);
          }}
          style={{
            width: "100%",
            height: "100%",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 22,
            lineHeight: 1.25,
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: 4,
            color: "#1a1a1a",
            cursor: "text",
            touchAction: "manipulation",
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
        >
          {shape.props.content || (
            <span style={{ opacity: 0.35 }}>Tap ✎ or double-tap to type</span>
          )}
        </div>
        {isSelected && (
          <button
            title="Edit text"
            aria-label="Edit text"
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

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "auto",
      }}
    >
      <textarea
        ref={areaRef}
        value={draft}
        spellCheck={false}
        autoCapitalize="sentences"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          // Commit every keystroke into the record so the change syncs and
          // persists like any other edit.
          editor.updateShape<TextShape>({
            id: shape.id,
            type: "inkboard-text",
            props: {
              content: value,
              h: clampHeight(e.target.scrollHeight),
            },
          });
        }}
        onKeyDown={(e) => {
          // Escape leaves editing without losing what was typed.
          if (e.key === "Escape") {
            e.preventDefault();
            editor.setEditingShape(null);
          }
          e.stopPropagation();
        }}
        onBlur={() => {
          // Commit the final draft, then leave the editing state. An empty
          // shape is an accident, not a sentence: delete it rather than
          // leaving a faint placeholder box behind.
          if (draft === "") {
            editor.deleteShapes([shape.id]);
          } else if (draft !== shape.props.content) {
            editor.updateShape<TextShape>({
              id: shape.id,
              type: "inkboard-text",
              props: { content: draft },
            });
          }
          editor.setEditingShape(null);
        }}
        style={{
          width: "100%",
          height: "100%",
          resize: "none",
          border: "1.5px dashed rgba(91, 141, 255, 0.8)",
          borderRadius: 6,
          background: "rgba(255,255,255,0.94)",
          padding: 4,
          margin: 0,
          fontSize: 22,
          lineHeight: 1.25,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#1a1a1a",
          overflow: "hidden",
          boxSizing: "border-box",
          outline: "none",
          touchAction: "manipulation",
        }}
      />
    </HTMLContainer>
  );
}

function clampHeight(raw: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, raw + LINE_PAD));
}
