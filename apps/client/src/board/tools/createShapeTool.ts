import { StateNode, createShapeId, type TLEventHandlers } from "tldraw";

export interface ShapeToolOptions {
  /**
   * When true, the freshly placed shape immediately enters tldraw's editing
   * state. Used by the text tool so the flow is "tap the tool, tap the
   * board, type" — no second tap to open an editor (REVIEW P2-1).
   */
  autoEdit?: boolean;
}

/**
 * Factory for a minimal "click to place" tool: on pointer down, creates one
 * shape of `shapeType` at the click position and returns to the select tool.
 * Shared by the Text/Math/Arrow/Rough toolbar tools.
 */
export function createShapeTool(id: string, shapeType: string, options: ShapeToolOptions = {}) {
  return class extends StateNode {
    static override id = id;

    override onPointerDown: TLEventHandlers["onPointerDown"] = () => {
      const { currentPagePoint } = this.editor.inputs;
      const shapeId = createShapeId();
      this.editor.createShape({
        id: shapeId,
        type: shapeType,
        x: currentPagePoint.x,
        y: currentPagePoint.y,
      });
      if (options.autoEdit) {
        // Stay on the placement tool and open editing immediately: the flow
        // is "tap the tool, tap the board, type". Snapping back to select
        // first lets the select tool's transition clear the editing shape,
        // so editing is armed *after* the creation instead.
        this.editor.setEditingShape(shapeId);
        return;
      }
      this.editor.setCurrentTool("select");
    };
  };
}
