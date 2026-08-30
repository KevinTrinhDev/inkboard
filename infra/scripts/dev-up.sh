#!/usr/bin/env bash
# One command to start inkboard: build if needed, publish the .local name,
# start the server, start Caddy, and open the laptop's camera view.
#
# Everything here is meant to be idempotent and unattended. The goal is that
# a normal session is exactly this: run it, pick up the iPad, draw.
set -euo pipefail

# Exported, not just assigned: the Caddyfile reads {$REPO_ROOT} from the
# environment, and Caddy refuses to parse its config when it is unset
# ("Wrong argument count or unexpected line ending after 'root'"), so
# dev-up.sh failed at the Caddy step before this.
export REPO_ROOT
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FORCE_BUILD=0
PAIR_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=1 ;;
    # Forget every paired device and print a fresh QR. Pairing now persists
    # across restarts, so this is the way to add or replace a device.
    --pair) PAIR_ARGS+=("--pair") ;;
    *) echo "unknown option: $arg (supported: --build, --pair)" >&2; exit 2 ;;
  esac
done

# First run used to hard-exit here telling the operator to go copy a file and
# hand-generate a secret. There is nothing here a script cannot do itself.
if [ ! -f .env ]; then
  echo "No .env found, creating one from .env.example..."
  cp .env.example .env
  chmod 600 .env
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
    # The placeholder is the whole value, so replace the entire line rather
    # than substituting inside it.
    sed -i "s|^PAIRING_TOKEN_SECRET=.*|PAIRING_TOKEN_SECRET=${secret}|" .env
    echo "  Generated a random PAIRING_TOKEN_SECRET."
  else
    echo "  openssl not found: edit .env and set PAIRING_TOKEN_SECRET by hand." >&2
    exit 1
  fi
fi

# Load .env into the environment so CADDY_DOMAIN and SERVER_PORT actually
# reach Caddy. Previously .env was checked for existence and then ignored, so
# editing either value in .env changed the server but not the proxy in front
# of it.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

SERVER_PORT="${SERVER_PORT:-8080}"
CADDY_DOMAIN="${CADDY_DOMAIN:-inkboard.local}"
export SERVER_PORT CADDY_DOMAIN

# The LAN address the iPad will actually reach. Also handed to Caddy so the
# site answers on the raw IP too, which is the documented fallback for when
# mDNS is unavailable; without it that fallback failed the TLS handshake
# because the only site block matched the .local host name.
export CADDY_LAN_IP
CADDY_LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
CADDY_LAN_IP="${CADDY_LAN_IP:-127.0.0.1}"

if ! command -v caddy >/dev/null 2>&1; then
  echo "caddy is not installed. See https://caddyserver.com/docs/install" >&2
  exit 1
fi

# Fail loudly if something already holds the ports. A leftover Caddy from a
# previous run keeps UDP 443 (its HTTP/3 listener) even when TCP looks free,
# and the resulting error ("listen udp :443: bind: address already in use")
# arrives buried in JSON logs after a full build.
for spec in "tcp 443" "udp 443" "tcp ${SERVER_PORT}"; do
  proto="${spec% *}"
  port="${spec#* }"
  flag="-tln"
  [ "$proto" = "udp" ] && flag="-uln"
  if ss "$flag" 2>/dev/null | grep -qE "[:.]${port}\b"; then
    echo "Port ${port}/${proto} is already in use, so inkboard cannot start." >&2
    echo "  Find it with:  ss -tlnup | grep ${port}" >&2
    echo "  A leftover inkboard? Try:  systemctl --user stop inkboard; pkill -f 'caddy run'" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# mDNS. Avahi publishes this machine's own hostname and nothing else, so
# `inkboard.local` never resolved from the iPad even though every doc, the
# pairing QR and the CA-install URL all point at it. Publish it ourselves for
# as long as the server runs. Uses the live LAN IP rather than a hard-coded
# one so it keeps working across DHCP changes.
# ---------------------------------------------------------------------------
MDNS_PID=""
if [[ "$CADDY_DOMAIN" == *.local ]]; then
  if command -v avahi-publish >/dev/null 2>&1; then
    # Published in a supervising loop rather than once. avahi-publish binds
    # one fixed address, so if DHCP moves this machine mid-session the name
    # keeps resolving to an address nothing is listening on, and the iPad
    # fails in the most confusing way possible: a name that resolves but
    # never connects. Re-publish whenever the address actually changes.
    #
    # -R: publish the address record without a reverse entry, which is what
    # allows a second name to coexist with the machine's real hostname.
    (
      published=""
      child=""
      trap 'kill "$child" 2>/dev/null; exit 0' TERM INT
      while true; do
        current="$(hostname -I 2>/dev/null | awk '{print $1}')"
        if [ -n "$current" ] && [ "$current" != "$published" ]; then
          [ -n "$child" ] && kill "$child" 2>/dev/null
          avahi-publish -a -R "$CADDY_DOMAIN" "$current" >/dev/null 2>&1 &
          child=$!
          published="$current"
          echo "mDNS: ${CADDY_DOMAIN} -> ${current}"
        fi
        sleep 20
      done
    ) &
    MDNS_PID=$!
  else
    echo "WARNING: avahi-publish not found, so ${CADDY_DOMAIN} will not resolve." >&2
    echo "  Install it once with:  sudo apt install avahi-utils" >&2
    echo "  Until then, use https://${CADDY_LAN_IP} on the iPad instead." >&2
  fi
fi

SERVER_PID=""
CADDY_PID=""
cleanup() {
  # Kill the whole process group, not just the direct child. `pnpm` spawns
  # tsx which spawns node, and the listening socket belongs to that
  # grandchild: killing only $SERVER_PID left node holding the port, so the
  # next run died with EADDRINUSE while this script carried on to Caddy and
  # served a padlock in front of nothing.
  [ -n "$SERVER_PID" ] && kill -- "-$SERVER_PID" 2>/dev/null || true
  [ -n "$CADDY_PID" ] && kill "$CADDY_PID" 2>/dev/null || true
  [ -n "$MDNS_PID" ] && kill -- "-$MDNS_PID" 2>/dev/null || kill "$MDNS_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Build only when something actually changed. This used to rebuild the whole
# workspace (tldraw and katex included) on every single start, which is most
# of the wait before you can draw.
# ---------------------------------------------------------------------------
STAMP=".inkboard-build-stamp"
sources_hash() {
  find apps packages -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.html' -o -name 'package.json' \) \
    -not -path '*/node_modules/*' -not -path '*/dist/*' \
    -print0 2>/dev/null | sort -z | xargs -0 sha1sum 2>/dev/null | sha1sum | awk '{print $1}'
}
CURRENT_HASH="$(sources_hash)"
# Every dist/ the runtime actually needs is checked, not just the client's.
# The server is started with `pnpm start` (node dist/index.js) and imports
# @inkboard/shared-schema from its dist too, so a stamp that matches while
# either of those is missing would skip the build and then fail with
# ERR_MODULE_NOT_FOUND after Caddy was already serving a padlock.
if [ "$FORCE_BUILD" -eq 1 ] || [ ! -f "$STAMP" ] \
   || [ ! -d apps/client/dist ] || [ ! -d apps/server/dist ] \
   || [ ! -d packages/shared-schema/dist ] \
   || [ "$(cat "$STAMP" 2>/dev/null)" != "$CURRENT_HASH" ]; then
  # Builds every workspace package in dependency order, not just the client.
  # On a fresh checkout @inkboard/shared-schema has no dist yet, so building
  # the client on its own fails with "Cannot find module
  # '@inkboard/shared-schema'", which is exactly what first-time setup hits.
  echo "Building..."
  pnpm -r run build
  printf '%s' "$CURRENT_HASH" > "$STAMP"
else
  echo "No source changes since last build, skipping build (--build to force)."
fi

# Own process group so cleanup() can signal the whole tree.
set -m
echo "Starting server..."
pnpm --filter @inkboard/server start "${PAIR_ARGS[@]+"${PAIR_ARGS[@]}"}" &
SERVER_PID=$!
set +m

# Wait for the server to actually answer rather than sleeping and hoping. A
# bare `sleep 1` could not tell a slow start from a dead one, so a server
# that died on EADDRINUSE looked identical to one still booting.
echo -n "Waiting for the server"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${SERVER_PORT}/healthz" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "Server exited during startup. Is port ${SERVER_PORT} already in use?" >&2
    echo "  Check with:  ss -tlnp | grep ${SERVER_PORT}" >&2
    exit 1
  fi
  echo -n "."
  sleep 0.25
done

echo "Starting Caddy (Ctrl+C to stop everything)..."
XDG_DATA_HOME="$REPO_ROOT/infra/caddy/data" caddy run \
  --config "$REPO_ROOT/infra/caddy/Caddyfile" --adapter caddyfile &
CADDY_PID=$!

# Export the local CA next to the repo root if it is not there yet, so
# https://<host>/inkboard-ca.crt is downloadable on the iPad without having to
# run a second script first. Caddy generates the CA on its first start, so by
# this point it exists.
CA_SRC="$REPO_ROOT/infra/caddy/data/caddy/pki/authorities/local/root.crt"
CA_DEST="$REPO_ROOT/inkboard-ca.crt"

# Open the laptop's camera view automatically once TLS is actually answering.
for _ in $(seq 1 40); do
  if curl -sk "https://127.0.0.1/healthz" >/dev/null 2>&1; then
    if [ ! -f "$CA_DEST" ] && [ -f "$CA_SRC" ]; then
      cp "$CA_SRC" "$CA_DEST"
      echo "Exported the local CA to inkboard-ca.crt (install it once on the iPad)."
    fi
    # INKBOARD_NO_OPEN is set by the systemd user unit: a background service
    # must never try to open a browser.
    if [ -z "${INKBOARD_NO_OPEN:-}" ] && command -v xdg-open >/dev/null 2>&1; then
      echo "Opening the camera view: https://${CADDY_DOMAIN}/mirror"
      xdg-open "https://${CADDY_DOMAIN}/mirror" >/dev/null 2>&1 || true
    fi
    break
  fi
  sleep 0.25
done

# Wait for whichever of the two exits FIRST, then fall out of the script so
# the supervisor can restart the whole stack.
#
# This used to `wait "$CADDY_PID"` only. If the Fastify server died while
# Caddy kept running, the script sat here happily: `systemctl --user status`
# showed the unit active, port 443 still answered a TLS handshake, and every
# request 502'd. From the iPad that is indistinguishable from a working
# server, and Restart=always never fired because nothing had exited.
wait -n "$SERVER_PID" "$CADDY_PID" 2>/dev/null || true

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "The server exited; shutting down so the stack can restart cleanly." >&2
else
  echo "Caddy exited; shutting down so the stack can restart cleanly." >&2
fi
# cleanup() runs on EXIT and takes the survivor with it.
exit 1
