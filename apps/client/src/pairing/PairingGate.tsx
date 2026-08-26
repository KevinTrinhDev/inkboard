import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "inkboard.pairingToken";

interface PairingContextValue {
  token: string | null;
  // Called when the stored credential is discovered to be dead (a 401 on an
  // API call, or the signaling socket closing 4401): drops it and bounces
  // straight back to the "scan to pair" screen instead of sitting there
  // silently showing "Offline" forever with no way to tell what's wrong or
  // fix it. See docs/BACKLOG.md.
  forgetToken: () => void;
}

const PairingTokenContext = createContext<PairingContextValue | null>(null);

/** The paired credential, available to anything rendered inside <PairingGate>. */
export function usePairingToken(): string | null {
  return useContext(PairingTokenContext)?.token ?? null;
}

/** Call when a request using the stored credential comes back rejected. */
export function useForgetPairingToken(): () => void {
  const ctx = useContext(PairingTokenContext);
  return ctx?.forgetToken ?? (() => {});
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Gates access to the board until a pairing token is present. The token
 * arrives via the `?token=` query param after scanning the terminal QR code
 * (see apps/server/src/pairing/printQr.ts) and is then persisted locally.
 */
export function PairingGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());

  useEffect(() => {
    if (token) return;
    const params = new URLSearchParams(window.location.search);
    const scanned = params.get("token");
    if (!scanned) return;

    fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: scanned }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { credential: string }) => {
        try {
          localStorage.setItem(STORAGE_KEY, data.credential);
        } catch {
          // Best effort: pairing still works for this session even if
          // storage is unavailable (e.g. private browsing).
        }
        setToken(data.credential);
      })
      .catch(() => {
        // Leave the gate up; the operator can re-scan.
      });
  }, [token]);

  const forgetToken = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best effort, still clear the in-memory token below either way.
    }
    setToken(null);
  }, []);

  // Stable reference across renders unless token actually changes: without
  // this, a new object here on every render would flow through context to
  // useRecordingRig's effects (the signaling socket, the sync loop), whose
  // dependency arrays include this callback, and could cause them to tear
  // down and reconnect on every unrelated re-render instead of only when
  // pairing state actually changes.
  const contextValue = useMemo(() => ({ token, forgetToken }), [token, forgetToken]);

  if (!token) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>inkboard</h1>
        <p>Not paired with a server yet.</p>
        <p>
          Scan the pairing QR code printed in the server's terminal with the
          iPad's Camera app, then tap the notification to open this link.
        </p>
      </main>
    );
  }

  return (
    <PairingTokenContext.Provider value={contextValue}>{children}</PairingTokenContext.Provider>
  );
}
