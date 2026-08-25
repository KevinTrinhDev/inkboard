#!/usr/bin/env bash
# Restrict inbound traffic to inkboard's ports to the local LAN subnet only.
# Run once, with sudo. See docs/SECURITY.md.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw is not installed (sudo apt install ufw)." >&2
  exit 1
fi

read -rp "LAN subnet to allow (e.g. 192.168.1.0/24): " LAN_SUBNET
if [ -z "$LAN_SUBNET" ]; then
  echo "No subnet given, aborting." >&2
  exit 1
fi

ufw default deny incoming
ufw allow from "$LAN_SUBNET" to any port 443 proto tcp comment "inkboard HTTPS"
ufw allow from "$LAN_SUBNET" to any port 5353 proto udp comment "inkboard mDNS"

echo
echo "Rules staged. Review with 'ufw status verbose' before enabling:"
echo "  sudo ufw enable"
