#!/usr/bin/env bash
# One-time setup: generate Caddy's local CA and print the iPad trust steps.
# See infra/caddy/README.md for the full flow.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CADDY_DIR="$REPO_ROOT/infra/caddy"
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
  echo "Expected CA cert not found at $CA_CERT — check Caddy's output above." >&2
  exit 1
fi

DEST="$REPO_ROOT/inkboard-ca.crt"
cp "$CA_CERT" "$DEST"

cat <<EOF

Local CA exported to: $DEST

Next steps on the iPad:
  1. AirDrop (or otherwise transfer) $DEST to the iPad.
  2. Open it -> iOS prompts to install a Configuration Profile.
     Settings -> General -> VPN & Device Management -> install it.
  3. Enable full trust:
     Settings -> General -> About -> Certificate Trust Settings -> toggle ON.
  4. Open https://\${CADDY_DOMAIN:-inkboard.local} in Safari - expect a
     trusted padlock, no warning.

Full detail: infra/caddy/README.md
EOF
