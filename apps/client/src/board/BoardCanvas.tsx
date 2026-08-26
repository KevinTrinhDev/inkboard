import { Tldraw, type TLComponents } from "tldraw";
import "tldraw/tldraw.css";
import { TextShapeUtil } from "./shapes/TextShapeUtil";
import { MathShapeUtil } from "./shapes/MathShapeUtil";
import { ArrowShapeUtil } from "./shapes/ArrowShapeUtil";
import { RoughShapeUtil } from "./shapes/RoughShapeUtil";
import { createShapeTool } from "./tools/createShapeTool";
import { AppToolbar } from "./AppToolbar";

// Ink strokes use tldraw's native `draw` shape/tool directly: that's the
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
  Toolbar: AppToolbar,
  // The default menu/style-panel chrome doesn't fit a purpose-built,
  // boring recording tool: replaced entirely by AppToolbar above.
  MainMenu: null,
  StylePanel: null,
  PageMenu: null,
};

export function BoardCanvas() {
  return (
    // touch-action: none lives here, scoped to the drawing surface only,
    // not on html/body, so Safari hands pen/touch gestures straight to
    // tldraw instead of intercepting them as page pan/zoom, without also
    // risking WebKit's touch-action:none-suppresses-tap-to-click quirk on
    // the toolbar buttons that sit outside this element. See index.html.
    <div style={{ position: "fixed", inset: 0, touchAction: "none" }}>
      <Tldraw shapeUtils={shapeUtils} tools={tools} components={components} />
    </div>
  );
}
