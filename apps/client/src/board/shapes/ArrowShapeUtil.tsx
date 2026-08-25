import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from "tldraw";

export type ArrowShape = TLBaseShape<"inkboard-arrow", { w: number; h: number }>;

/**
 * Toolbar stub — registers the tool so it's present in the UI. Full
 * multi-point arrow rendering (matching packages/shared-schema's ArrowObject)
 * is not required for the M0 latency/permissions proof-of-concept.
 */
export class ArrowShapeUtil extends BaseBoxShapeUtil<ArrowShape> {
  static override type = "inkboard-arrow" as const;
  static override props: RecordProps<ArrowShape> = { w: T.number, h: T.number };

  getDefaultProps(): ArrowShape["props"] {
    return { w: 120, h: 4 };
  }

  component(shape: ArrowShape) {
    return (
      <HTMLContainer>
        <svg width={shape.props.w} height={20}>
          <line
            x1={0}
            y1={10}
            x2={shape.props.w}
            y2={10}
            stroke="#1a1a1a"
            strokeWidth={2}
            markerEnd="url(#inkboard-arrowhead)"
          />
          <defs>
            <marker
              id="inkboard-arrowhead"
              markerWidth={8}
              markerHeight={8}
              refX={6}
              refY={4}
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#1a1a1a" />
            </marker>
          </defs>
        </svg>
      </HTMLContainer>
    );
  }

  indicator(shape: ArrowShape) {
    return <rect width={shape.props.w} height={20} />;
  }
}
