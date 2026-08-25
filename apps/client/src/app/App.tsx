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
      <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1000 }}>
        <CameraPreview stream={rig.stream} error={rig.cameraError} />
      </div>
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
