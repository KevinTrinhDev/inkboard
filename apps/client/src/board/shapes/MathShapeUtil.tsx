import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from "tldraw";
import katex from "katex";
import "katex/dist/katex.min.css";

export type MathShape = TLBaseShape<
  "inkboard-math",
  { w: number; h: number; latex: string }
>;

/**
 * Renders a hardcoded LaTeX string via KaTeX to prove the rendering path —
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
    const html = katex.renderToString(shape.props.latex, {
      throwOnError: false,
    });
    return (
      <HTMLContainer style={{ padding: 4 }}>
        <span dangerouslySetInnerHTML={{ __html: html }} />
      </HTMLContainer>
    );
  }

  indicator(shape: MathShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
