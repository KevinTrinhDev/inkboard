import { StateNode, createShapeId, type TLEventHandlers } from "tldraw";

/**
 * Factory for a minimal "click to place" tool: on pointer down, creates one
 * shape of `shapeType` at the click position and returns to the select tool.
 * Shared by the Text/Math/Arrow/Rough toolbar stubs.
 */
export function createShapeTool(id: string, shapeType: string) {
  return class extends StateNode {
    static override id = id;

    override onPointerDown: TLEventHandlers["onPointerDown"] = () => {
      const { currentPagePoint } = this.editor.inputs;
      this.editor.createShape({
        id: createShapeId(),
        type: shapeType,
        x: currentPagePoint.x,
        y: currentPagePoint.y,
      });
      this.editor.setCurrentTool("select");
    };
  };
}
