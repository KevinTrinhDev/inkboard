import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from "tldraw";

export type TextShape = TLBaseShape<
  "inkboard-text",
  { w: number; h: number; content: string; lang: string }
>;

/**
 * Renders plain styled text for now. Playpen-Sans wiring (7 alternates/glyph
 * + shuffler) is deferred to ROADMAP M5: the shape type and normalized
 * storage exist today so nothing about the data model changes when the font
 * lands. See packages/shared-schema/src/objects/text.ts for the persisted
 * shape.
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
    return { w: 220, h: 48, content: "Tap to edit", lang: "en" };
  }

  component(shape: TextShape) {
    return (
      <HTMLContainer
        style={{
          fontFamily: "system-ui, sans-serif", // Playpen Sans lands in M5
          fontSize: 24,
          padding: 4,
        }}
      >
        {shape.props.content}
      </HTMLContainer>
    );
  }

  indicator(shape: TextShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
