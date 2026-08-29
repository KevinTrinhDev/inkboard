#!/usr/bin/env bash
# One-command dev startup: build the client, start the server, start Caddy.
# Requires: infra/scripts/setup-local-ca.sh already run once.
set -euo pipefail

# Exported, not just assigned: the Caddyfile reads {$REPO_ROOT} from the
# environment, and Caddy refuses to parse its config when it is unset
# ("Wrong argument count or unexpected line ending after 'root'"), so
# dev-up.sh failed at the Caddy step before this.
export REPO_ROOT
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env ]; then
  echo ".env not found. Copy .env.example to .env and fill in real values first." >&2
  exit 1
fi

# Load .env into the environment so CADDY_DOMAIN and SERVER_PORT actually
# reach Caddy. Previously .env was checked for existence and then ignored, so
# editing either value in .env changed the server but not the proxy in front
# of it.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

echo "Building client..."
pnpm --filter @inkboard/client build

echo "Starting server..."
pnpm --filter @inkboard/server dev &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 1

echo "Starting Caddy (Ctrl+C to stop everything)..."
XDG_DATA_HOME="$REPO_ROOT/infra/caddy/data" caddy run \
  --config "$REPO_ROOT/infra/caddy/Caddyfile" --adapter caddyfile
