import { createContext, useContext, type ReactNode } from "react";
import { useForgetPairingToken, usePairingToken } from "../pairing/PairingGate";
import { useRecordingRig, type RecordingRig } from "./useRecordingRig";

const RecordingContext = createContext<RecordingRig | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const token = usePairingToken();
  const forgetToken = useForgetPairingToken();
  const rig = useRecordingRig(token, forgetToken);
  return <RecordingContext.Provider value={rig}>{children}</RecordingContext.Provider>;
}

export function useRecordingContext(): RecordingRig {
  const rig = useContext(RecordingContext);
  if (!rig) {
    throw new Error("useRecordingContext must be used within <RecordingProvider>");
  }
  return rig;
}
