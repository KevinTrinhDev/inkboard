import { useState } from "react";
import { PairingGate } from "../pairing/PairingGate";
import { BoardCanvas } from "../board/BoardCanvas";
import { CameraPreview } from "../av/CameraPreview";

export function App() {
  const [, setStream] = useState<MediaStream | null>(null);

  return (
    <PairingGate>
      <BoardCanvas />
      <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1000 }}>
        <CameraPreview onStream={setStream} />
      </div>
    </PairingGate>
  );
}
