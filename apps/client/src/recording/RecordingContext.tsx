import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useForgetPairingToken, usePairingToken } from "../pairing/PairingGate";
import { useRecordingRig, type RecordingRig } from "./useRecordingRig";
import { syncRoleFromLocation } from "../board/syncRole";

const RecordingContext = createContext<RecordingRig | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const token = usePairingToken();
  const forgetToken = useForgetPairingToken();
  // The laptop opens the mirror and owns the camera and mic; the iPad is the
  // board and captures nothing. See docs/ARCHITECTURE.md "Two-device setup".
  const capture = useMemo(
    () => syncRoleFromLocation(window.location) === "mirror",
    [],
  );
  const rig = useRecordingRig(token, forgetToken, capture);
  return <RecordingContext.Provider value={rig}>{children}</RecordingContext.Provider>;
}

export function useRecordingContext(): RecordingRig {
  const rig = useContext(RecordingContext);
  if (!rig) {
    throw new Error("useRecordingContext must be used within <RecordingProvider>");
  }
  return rig;
}
