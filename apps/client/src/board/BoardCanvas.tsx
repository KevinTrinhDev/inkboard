import { useCallback, useMemo, useState } from "react";
import { Tldraw, type Editor, type TLComponents } from "tldraw";
import { getAssetUrlsByMetaUrl } from "@tldraw/assets/urls";
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

/**
 * tldraw's own icons, fonts and translations, bundled into our build instead
 * of fetched from cdn.tldraw.com at runtime.
 *
 * By default tldraw loads them from its CDN. That is wrong here twice over:
 * the app's whole premise is that it works on a LAN with no internet and that
 * nothing leaves your home network (see docs/SECURITY.md), and the server's
 * own Content-Security-Policy allows only 'self', so those requests were
 * blocked outright. Real symptom: a stream of
 * "EncodingError: The source image cannot be decoded" on both devices and
 * missing icons in tldraw's built-in UI.
 *
 * getAssetUrlsByMetaUrl() resolves every asset through `import.meta.url`, so
 * Vite fingerprints them into dist/ and they are served from our own origin.
 */
const assetUrls = getAssetUrlsByMetaUrl();

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

      // Always start a session with palm rejection off.
      //
      // tldraw latches `isPenMode` the first time it sees a `pointerType:
      // "pen"` event, and from then on ignores touch input for drawing. That
      // is correct behaviour with a real Apple Pencil (it lets you rest your
      // hand on the glass), but it is a trap for any third-party stylus:
      // those are indistinguishable from a finger, so they arrive as "touch"
      // and stop drawing entirely once pen mode is on. Since instance state
      // is persisted per device, a single stray pen event could leave the
      // board permanently unresponsive to the stylus with no visible cause
      // and no obvious way back.
      //
      // Resetting on mount keeps within-session palm rejection for an actual
      // Apple Pencil while guaranteeing that reloading the page always
      // restores a board that a plain stylus can draw on.
      mounted.updateInstanceState({ isPenMode: false });

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
        assetUrls={assetUrls}
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
