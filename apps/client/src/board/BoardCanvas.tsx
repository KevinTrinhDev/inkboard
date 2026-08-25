import { Tldraw, type TLComponents } from "tldraw";
import "tldraw/tldraw.css";
import { TextShapeUtil } from "./shapes/TextShapeUtil";
import { MathShapeUtil } from "./shapes/MathShapeUtil";
import { ArrowShapeUtil } from "./shapes/ArrowShapeUtil";
import { RoughShapeUtil } from "./shapes/RoughShapeUtil";
import { createShapeTool } from "./tools/createShapeTool";

// Ink strokes use tldraw's native `draw` shape/tool directly — that's the
// path that has to feel instant under an Apple Pencil, so it deliberately
// carries no custom logic. See docs/ARCHITECTURE.md "Canvas engine".
const shapeUtils = [TextShapeUtil, MathShapeUtil, ArrowShapeUtil, RoughShapeUtil];

const tools = [
  createShapeTool("inkboard-text", "inkboard-text"),
  createShapeTool("inkboard-math", "inkboard-math"),
  createShapeTool("inkboard-arrow", "inkboard-arrow"),
  createShapeTool("inkboard-shape", "inkboard-shape"),
];

const components: TLComponents = {
  // Default tldraw UI is enough for the M0 proof-of-concept; a boring,
  // purpose-built toolbar (pen/eraser/undo/redo/page/record) is a later
  // polish pass, not part of this scaffold.
};

export function BoardCanvas() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw shapeUtils={shapeUtils} tools={tools} components={components} />
    </div>
  );
}
