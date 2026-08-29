import { useCallback, useMemo, useState } from "react";
import { Tldraw, type Editor, type TLComponents } from "tldraw";
import "tldraw/tldraw.css";
import { TextShapeUtil } from "./shapes/TextShapeUtil";
import { MathShapeUtil } from "./shapes/MathShapeUtil";
import { ArrowShapeUtil } from "./shapes/ArrowShapeUtil";
import { RoughShapeUtil } from "./shapes/RoughShapeUtil";
import { createShapeTool } from "./tools/createShapeTool";
import { AppToolbar } from "./AppToolbar";
import { createAssetStore } from "./assetStore";
import { syncRoleFromLocation } from "./syncRole";
import { useBoardSync } from "./useBoardSync";
import { SyncStatusPill } from "./SyncStatusPill";
import { useForgetPairingToken, usePairingToken } from "../pairing/PairingGate";

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

const editorComponents: TLComponents = {
  Toolbar: AppToolbar,
  // The default menu/style-panel chrome doesn't fit a purpose-built,
  // boring recording tool: replaced entirely by AppToolbar above.
  MainMenu: null,
  StylePanel: null,
  PageMenu: null,
};

// The mirror is a window onto the iPad, not a second place to work, so it
// carries no chrome at all. Nothing here is interactive.
const mirrorComponents: TLComponents = {
  ...editorComponents,
  Toolbar: null,
};

export function BoardCanvas() {
  const token = usePairingToken();
  const forgetToken = useForgetPairingToken();
  const [editor, setEditor] = useState<Editor | null>(null);

  // Read once: the role is a property of how this device was opened, and
  // re-reading it mid-session would tear the sync subscription down.
  const role = useMemo(() => syncRoleFromLocation(window.location), []);

  const assets = useMemo(() => createAssetStore(() => token), [token]);
  const { status, peers } = useBoardSync(editor, token, role, forgetToken);

  const handleMount = useCallback(
    (mounted: Editor) => {
      // There is no readonly prop on the component in tldraw 3.x; instance
      // state is the supported path.
      if (role === "mirror") {
        mounted.updateInstanceState({ isReadonly: true });
      }
      setEditor(mounted);
    },
    [role],
  );

  return (
    // touch-action: none lives here, scoped to the drawing surface only,
    // not on html/body, so Safari hands pen/touch gestures straight to
    // tldraw instead of intercepting them as page pan/zoom, without also
    // risking WebKit's touch-action:none-suppresses-tap-to-click quirk on
    // the toolbar buttons that sit outside this element. See index.html.
    <div style={{ position: "fixed", inset: 0, touchAction: "none" }}>
      <Tldraw
        shapeUtils={shapeUtils}
        tools={tools}
        components={role === "mirror" ? mirrorComponents : editorComponents}
        assets={assets}
        onMount={handleMount}
      />
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        <SyncStatusPill status={status} peers={peers} role={role} />
      </div>
    </div>
  );
}
