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
// path that has to feel instant under any pen (Apple Pencil, a generic
// stylus, or a finger), so it deliberately carries no custom logic. See
// docs/ARCHITECTURE.md "Canvas engine".
//
// Arrow and shapes are tldraw's native `arrow`/`geo`/`line` tools (full drag
// interactions). ArrowShapeUtil/RoughShapeUtil stay registered only so board
// records created by the old M0 stub tools still render; the toolbar no
// longer creates them.
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
  // The text tool opens straight into editing: pencil-first flow is tap the
  // tool, tap the board, type (see TextShapeUtil).
  createShapeTool("inkboard-text", "inkboard-text", { autoEdit: true }),
  // Math likewise: tap the tool, tap the board, type LaTeX with live preview.
  createShapeTool("inkboard-math", "inkboard-math", { autoEdit: true }),
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
  const { status, peers, takeOver } = useBoardSync(editor, token, role, forgetToken);

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

      // Debug/testing handle: lets Playwright specs and ad-hoc probes drive
      // the real editor (scripts/screenshots.mjs, future e2e) without
      // reaching into React internals.
      (window as unknown as { __inkboard?: { editor: Editor } }).__inkboard = {
        editor: mounted,
      };
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
      {role === "editor" && status === "contended" && (
        // Another device currently holds the pen and this device was refused
        // (editor-contended). The pill alone is not enough: the operator
        // needs to know the board is frozen on this device and what to do
        // about it.
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 10px 8px 16px",
            borderRadius: 999,
            font: "500 13px/1.2 system-ui, -apple-system, sans-serif",
            color: "#fff",
            background: "rgba(30, 27, 75, 0.92)",
            border: "1px solid rgba(167, 139, 250, 0.4)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
            touchAction: "manipulation",
          }}
        >
          <span>Another device holds the pen.</span>
          <button
            onClick={takeOver}
            style={{
              flexShrink: 0,
              padding: "7px 14px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(255,255,255,0.16)",
              color: "#fff",
              cursor: "pointer",
              font: "600 12.5px system-ui, sans-serif",
              touchAction: "manipulation",
            }}
          >
            Use this device
          </button>
        </div>
      )}
    </div>
  );
}
