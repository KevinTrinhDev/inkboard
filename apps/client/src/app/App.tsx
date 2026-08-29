import { lazy, Suspense } from "react";
import { PairingGate } from "../pairing/PairingGate";
import { CameraPreview } from "../av/CameraPreview";
import { RecordingProvider, useRecordingContext } from "../recording/RecordingContext";

// The tldraw editor (plus katex, react-dom internals it pulls in) is the
// bulk of the client bundle. An unpaired device shouldn't have to download
// any of it just to see the "scan the QR code" screen, so it's only
// imported once PairingGate actually renders this as a child.
const BoardCanvas = lazy(() =>
  import("../board/BoardCanvas").then((mod) => ({ default: mod.BoardCanvas })),
);

function AppShell() {
  const rig = useRecordingContext();

  return (
    <>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading board…</div>}>
        <BoardCanvas />
      </Suspense>
      {rig.previewVisible && (
        <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1000 }}>
          <CameraPreview stream={rig.stream} error={rig.cameraError} />
        </div>
      )}
      {/* A take that failed to encrypt or queue is gone, so say so loudly
          rather than letting a lost recording look like a saved one. */}
      {rig.saveError && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1001,
            maxWidth: "min(90vw, 480px)",
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(180, 32, 32, 0.94)",
            color: "#fff",
            font: "500 13px/1.4 system-ui, sans-serif",
          }}
        >
          Recording was not saved: {rig.saveError}
        </div>
      )}
    </>
  );
}

export function App() {
  return (
    <PairingGate>
      <RecordingProvider>
        <AppShell />
      </RecordingProvider>
    </PairingGate>
  );
}
