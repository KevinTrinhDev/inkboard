import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from "tldraw";

export type RoughShape = TLBaseShape<"inkboard-shape", { w: number; h: number }>;

/**
 * Toolbar stub for the sketchy-rectangle shape type (matches
 * packages/shared-schema's ShapeObject "rect" kind). A real hand-drawn
 * render (e.g. Rough.js) is not required for the M0 proof-of-concept.
 */
export class RoughShapeUtil extends BaseBoxShapeUtil<RoughShape> {
  static override type = "inkboard-shape" as const;
  static override props: RecordProps<RoughShape> = { w: T.number, h: T.number };

  getDefaultProps(): RoughShape["props"] {
    return { w: 160, h: 100 };
  }

  component(shape: RoughShape) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          border: "2px solid #1a1a1a",
          borderRadius: 4,
        }}
      />
    );
  }

  indicator(shape: RoughShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
