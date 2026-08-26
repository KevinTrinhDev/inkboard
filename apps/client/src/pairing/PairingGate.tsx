import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "inkboard.pairingToken";

const PairingTokenContext = createContext<string | null>(null);

/** The paired credential, available to anything rendered inside <PairingGate>. */
export function usePairingToken(): string | null {
  return useContext(PairingTokenContext);
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
    <PairingTokenContext.Provider value={token}>{children}</PairingTokenContext.Provider>
  );
}
