# Caddy local HTTPS

`Caddyfile` reverse-proxies `https://<CADDY_DOMAIN>` (default
`inkboard.local`) to the Fastify server on `127.0.0.1:<SERVER_PORT>`, using
Caddy's built-in local CA (`tls internal`) instead of a public cert. This
exists because `getUserMedia` (camera/mic access) requires a secure context:
plain `http://<lan-ip>` will not work.

## One-time setup

Run `infra/scripts/setup-local-ca.sh`, which:
1. Starts Caddy briefly so it generates its local root CA under
   `infra/caddy/data/` (gitignored: this is private key material).
2. Extracts the root CA certificate to a path you can transfer to the iPad.
3. Prints the iPad trust steps (below).

## Trusting the certificate on iPad

1. AirDrop or otherwise transfer the exported `.crt` file to the iPad.
2. Open it: iOS prompts to install a Configuration Profile.
   `Settings → General → VPN & Device Management → [inkboard CA] → Install`.
3. Enable full trust: `Settings → General → About → Certificate Trust
   Settings → toggle on for the inkboard CA`.
4. Open `https://inkboard.local` (or your `CADDY_DOMAIN`) in Safari: it
   should show a trusted padlock with no warning.

## LAN hostname

`inkboard.local` relies on mDNS (Avahi, ships with Ubuntu by default) so the
hostname keeps resolving even if the XPS's DHCP-assigned IP changes: a raw
IP would break both the trusted cert and the iPad's "Add to Home Screen"
bookmark on the next lease renewal. If mDNS isn't reliable on your router,
set a static DHCP reservation for the XPS instead and update `CADDY_DOMAIN`
accordingly.
