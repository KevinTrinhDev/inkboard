#!/usr/bin/env bash
# One-time setup: generate Caddy's local CA and print the iPad trust steps.
# See infra/caddy/README.md for the full flow.
set -euo pipefail

# Exported for the same reason as in dev-up.sh: the Caddyfile reads
# {$REPO_ROOT} from the environment and will not parse without it.
export REPO_ROOT
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CADDY_DIR="$REPO_ROOT/infra/caddy"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi
DATA_DIR="$CADDY_DIR/data"

if ! command -v caddy >/dev/null 2>&1; then
  echo "caddy is not installed. See https://caddyserver.com/docs/install" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

echo "Starting Caddy briefly to generate its local CA..."
XDG_DATA_HOME="$DATA_DIR" caddy run --config "$CADDY_DIR/Caddyfile" --adapter caddyfile &
CADDY_PID=$!
sleep 3
kill "$CADDY_PID" 2>/dev/null || true
wait "$CADDY_PID" 2>/dev/null || true

CA_CERT="$DATA_DIR/caddy/pki/authorities/local/root.crt"
if [ ! -f "$CA_CERT" ]; then
  echo "Expected CA cert not found at $CA_CERT, check Caddy's output above." >&2
  exit 1
fi

DEST="$REPO_ROOT/inkboard-ca.crt"
cp "$CA_CERT" "$DEST"

cat <<EOF

Local CA exported to: $DEST

Next steps on the iPad. The server is a Linux box, so there is no AirDrop:
the cert is served over the already-firewalled 443 port instead.

  1. Start the server:  ./infra/scripts/dev-up.sh
  2. On the iPad, open:
       https://${CADDY_DOMAIN:-inkboard.local}/inkboard-ca.crt
     Safari warns that the certificate is untrusted, which is expected: it
     is the cert you are about to trust. Continue past the warning.
     If the .local name does not resolve, use the LAN IP instead.
  3. iOS downloads a Configuration Profile named "inkboard Local CA".
     Install it: Settings -> General -> VPN & Device Management.
     The name matters: Caddy's default CA name is "Caddy Local Authority",
     which any other Caddy project also uses, so an unrelated profile of
     that name may already be on the device. inkboard's is named after the
     project so the two cannot be confused.
  4. Enable full trust, which step 3 does NOT do on its own:
     Settings -> General -> About -> Certificate Trust Settings -> toggle ON.
     Look for "inkboard Local CA" there too.
  5. Reload https://${CADDY_DOMAIN:-inkboard.local} and expect a trusted
     padlock with no warning.

The file is also at $DEST if you would rather copy it across some other way.

Full detail: infra/caddy/README.md
EOF
