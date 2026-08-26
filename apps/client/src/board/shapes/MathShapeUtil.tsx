import { useEffect, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from "tldraw";

export type MathShape = TLBaseShape<
  "inkboard-math",
  { w: number; h: number; latex: string }
>;

// KaTeX (and its CSS) is only paid for once a Math object actually exists on
// the board, not on every page load: dynamic import, cached after first use.
let katexModulePromise: Promise<typeof import("katex")> | null = null;
function loadKatex() {
  katexModulePromise ??= import("katex").then(async (mod) => {
    await import("katex/dist/katex.min.css");
    return mod;
  });
  return katexModulePromise;
}

function MathRenderer({ latex }: { latex: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadKatex().then(({ default: katex }) => {
      if (cancelled) return;
      setHtml(katex.renderToString(latex, { throwOnError: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [latex]);

  if (html === null) {
    return <span style={{ opacity: 0.5, fontFamily: "monospace" }}>{latex}</span>;
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Renders a hardcoded LaTeX string via KaTeX to prove the rendering path:
 * math is never typed in the handwriting font (legibility of x/2/z matters
 * more than stylistic consistency). See docs/ARCHITECTURE.md.
 */
export class MathShapeUtil extends BaseBoxShapeUtil<MathShape> {
  static override type = "inkboard-math" as const;
  static override props: RecordProps<MathShape> = {
    w: T.number,
    h: T.number,
    latex: T.string,
  };

  getDefaultProps(): MathShape["props"] {
    return { w: 220, h: 60, latex: "x^2 + 7x + 12 = (x + 3)(x + 4)" };
  }

  component(shape: MathShape) {
    return (
      <HTMLContainer style={{ padding: 4 }}>
        <MathRenderer latex={shape.props.latex} />
      </HTMLContainer>
    );
  }

  indicator(shape: MathShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
