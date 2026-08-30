#!/usr/bin/env bash
# Restrict inbound traffic to inkboard's ports to the local LAN subnet only.
# Run once, with sudo. See docs/SECURITY.md.
#
# This is defence in depth, not a requirement: the Fastify server binds
# 127.0.0.1 (apps/server/src/index.ts), so nothing on the LAN can reach the API
# except through Caddy's TLS on 443 regardless of the firewall.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw is not installed (sudo apt install ufw)." >&2
  exit 1
fi

# Default to the subnet actually in use rather than making the operator work
# it out; still confirmable, since getting this wrong is how people lock
# themselves out of a machine.
DEFAULT_SUBNET="$(ip route 2>/dev/null | awk '/proto kernel/ && /src/ {print $1; exit}')"
read -rp "LAN subnet to allow [${DEFAULT_SUBNET:-192.168.1.0/24}]: " LAN_SUBNET
LAN_SUBNET="${LAN_SUBNET:-${DEFAULT_SUBNET:-}}"
if [ -z "$LAN_SUBNET" ]; then
  echo "No subnet given, aborting." >&2
  exit 1
fi

ufw default deny incoming
ufw allow from "$LAN_SUBNET" to any port 443 proto tcp comment "inkboard HTTPS"
# Caddy always enables an HTTP->HTTPS redirect on port 80, and an iPad user who
# types "inkboard.local" without a scheme lands there first. Without this rule
# that redirect hangs instead of bouncing to HTTPS, which looks exactly like
# the server being down.
ufw allow from "$LAN_SUBNET" to any port 80 proto tcp comment "inkboard HTTP redirect"
ufw allow from "$LAN_SUBNET" to any port 5353 proto udp comment "inkboard mDNS"

# `default deny incoming` blocks SSH too. Nothing listens on 22 on this machine
# today, but enabling sshd later with these rules in place would lock out
# remote access with no warning, so allow it from the LAN up front.
if ufw allow from "$LAN_SUBNET" to any port 22 proto tcp comment "SSH (LAN only)"; then
  echo "Allowed SSH from ${LAN_SUBNET} so enabling sshd later cannot lock you out."
fi

echo
echo "Rules staged. Note that 'default deny incoming' is already in force once"
echo "ufw is enabled. Review before enabling:"
echo "  sudo ufw status verbose"
echo "  sudo ufw enable"
