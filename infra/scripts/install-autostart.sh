#!/usr/bin/env bash
# Make inkboard run by itself, always, so a session is one step: pick up the
# iPad and draw.
#
# Installs a *user* systemd unit (no root for the service itself), starts it
# now, and enables it at login. The only privileged bit is `loginctl
# enable-linger`, which lets the service keep running when you are not logged
# in graphically; it is attempted and skipped cleanly if you decline.
#
# Undo with:  ./infra/scripts/install-autostart.sh --uninstall
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/inkboard.service"

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now inkboard.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "inkboard autostart removed."
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd not available; run ./infra/scripts/dev-up.sh by hand instead." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"

# Generated rather than copied, so the paths match this checkout and this
# machine instead of assuming ~/inkboard and a fixed node version.
#
# Every directory is derived from `command -v` rather than guessed. Guessing
# is how the first version of this failed: it used $PNPM_HOME directly, but
# the binary actually lives in $PNPM_HOME/bin, so the unit started, reached
# "Building...", exited 127 (command not found), and Restart=always turned
# that into a silent crash loop.
for tool in node pnpm caddy; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is not on PATH; install it before enabling autostart." >&2
    exit 1
  fi
done
SERVICE_PATH="$(dirname "$(command -v node)")"
SERVICE_PATH="$SERVICE_PATH:$(dirname "$(command -v pnpm)")"
SERVICE_PATH="$SERVICE_PATH:$(dirname "$(command -v caddy)")"
if command -v avahi-publish >/dev/null 2>&1; then
  SERVICE_PATH="$SERVICE_PATH:$(dirname "$(command -v avahi-publish)")"
fi
SERVICE_PATH="$SERVICE_PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cat > "$UNIT" <<EOF
[Unit]
Description=inkboard: teaching board server, mDNS name and local HTTPS
Documentation=https://github.com/KevinTrinhDev/inkboard
After=network-online.target
Wants=network-online.target
# Give up after repeated instant failures instead of hammering forever, so a
# genuine misconfiguration is visible in `systemctl --user status` rather
# than hidden in an endless restart loop. These belong in [Unit].
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
# dev-up.sh is the entry point rather than the server binary: it also
# publishes inkboard.local, exports the HTTPS certificate, keeps the mDNS
# record pointed at the current address, and starts Caddy.
ExecStart=$REPO_ROOT/infra/scripts/dev-up.sh
WorkingDirectory=$REPO_ROOT

# The laptop sleeps, changes networks and loses WiFi. Always come back,
# rather than leaving a dead server that looks identical to a working one
# from the iPad's side.
Restart=always
RestartSec=5

# Never open a browser from a background service.
Environment=INKBOARD_NO_OPEN=1
Environment=PATH=$SERVICE_PATH

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now inkboard.service

# Without lingering, the user manager stops when you log out, taking inkboard
# with it. Harmless to skip if you always stay logged in.
if ! loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
  echo
  echo "Optional: keep inkboard running when you are logged out."
  sudo loginctl enable-linger "$USER" 2>/dev/null \
    && echo "  Lingering enabled." \
    || echo "  Skipped (needs sudo). inkboard will run whenever you are logged in."
fi

echo
echo "inkboard now starts on its own."
echo "  status:  systemctl --user status inkboard"
echo "  logs:    journalctl --user -u inkboard -f"
echo "  pair a new device:  systemctl --user stop inkboard && ./infra/scripts/dev-up.sh --pair"
echo "  remove:  ./infra/scripts/install-autostart.sh --uninstall"
