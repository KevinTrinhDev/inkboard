# Security

## Threat model

inkboard is designed to run **on a trusted home LAN only**. It is explicitly
**not** designed, tested, or hardened for exposure to the public internet.
Do not port-forward any inkboard port. Do not put it behind a public reverse
proxy without a substantial redesign of the auth model below.

Assumed environment: a Ubuntu server (the "XPS") and an iPad, both on the same
home Wi-Fi/Ethernet network, with a consumer router providing NAT and no
inbound port forwarding.

## Transport

- The server is only reachable over HTTPS, via [Caddy](https://caddyserver.com)
  using its built-in local CA (`tls internal`). Browser media APIs
  (`getUserMedia`) require a secure context, so this isn't optional — plain
  `http://<lan-ip>` will not work for camera/mic access.
- The iPad must trust that local CA once: install the CA certificate as a
  Configuration Profile (`Settings → General → VPN & Device Management →
  install profile`), then enable full trust
  (`Settings → General → About → Certificate Trust Settings`). See
  `infra/caddy/README.md` for the exact steps and `infra/scripts/setup-local-ca.sh`.
- The server's LAN hostname is an mDNS `.local` name (via Avahi, which ships
  with Ubuntu) rather than a raw DHCP IP, so the trusted cert and the PWA's
  "Add to Home Screen" bookmark keep working if the device's IP changes.

## Network access control

- `infra/scripts/setup-ufw.sh` restricts inbound connections on the server's
  ports to the local LAN subnet only, and denies all other inbound traffic by
  default. No port is ever forwarded through the home router.
- Being on the same Wi-Fi is **not** treated as sufficient authorization by
  itself — anyone else on that network (a guest, a compromised IoT device)
  would otherwise satisfy "same LAN." Device pairing (below) is the real gate.

## Device pairing (application-layer auth)

- On server startup, a short-lived pairing token is generated and printed as a
  QR code in the terminal (`qrcode-terminal`).
- The iPad scans it once with the Camera app; the client stores the resulting
  token and presents it on the WebSocket handshake and any API calls.
- Tokens are signed/verified using `PAIRING_TOKEN_SECRET` (see `.env.example`)
  — generate a real value with `openssl rand -hex 32` and never commit it.
- A device that doesn't present a valid token cannot open the board, connect
  to the signaling WebSocket, or upload/read session data.
- Pairing (`POST /api/pair`) is separate from the credential used afterward:
  the scanned QR token is short-lived (5 minutes, single-use for pairing
  itself) but the credential it exchanges for is a distinct, longer-lived
  (30 day) session credential, signed with a domain-separated HMAC so
  neither can be replayed as the other. This split exists specifically so an
  offline recording session (see below) can still authenticate an upload
  hours or days later without forcing a re-pair.

## Offline recording

inkboard is offline-first: recording never depends on the signaling
WebSocket or any network reachability, only on local device storage.

- Pencil/camera/mic/disk are the only pre-flight gates on REC.
  `serverConnected` is shown in the UI but is informational only — dropping
  Wi-Fi mid-lesson does not stop or block a recording.
- A finished take is encrypted on-device (see "Encryption at rest" below)
  and written to the iPad's IndexedDB immediately, before any network
  attempt. It only ever leaves the device once a connection to the XPS
  actually exists.
- A background sync loop retries every 15 seconds and on the browser's
  `online` event, uploading anything still queued. The toolbar shows a
  "waiting to sync" count so the operator knows what hasn't reached the
  server yet.
- True Bluetooth/no-network live transport isn't possible for this use case
  — a camera feed needs far more bandwidth than Bluetooth (Classic or BLE)
  provides. Offline-first record-then-sync is the correct shape for "works
  without Wi-Fi": you're never blocked by the network being down, only
  delayed on when the recording reaches the XPS.

## Encryption at rest

Recordings are encrypted client-side before they are ever written to disk
anywhere, including the iPad's own local queue:

- A random AES-256-GCM key is generated on first use via the Web Crypto API
  and stored only in that device's IndexedDB. It is never transmitted to the
  server or included in any network request, in any form.
- Each recording is encrypted with a fresh random IV (prepended to the
  ciphertext) before being queued locally and before upload. The XPS stores
  the resulting `.webm.enc` file exactly as received — it never possesses
  the key and cannot decrypt it.
- Practical effect: someone with access to the XPS (theft, another local
  user, a backup that leaks) gets only ciphertext. Only the iPad that
  recorded a given session can decrypt it.
- Trade-off, stated plainly: this key has no recovery mechanism by design.
  If the iPad resets, its browser storage is cleared, or the device is
  lost, every recording encrypted with that key becomes permanently
  unreadable — there is no backdoor and no export of the key today. A
  future milestone could add an explicit "export/back up this key" flow if
  that trade-off turns out to be wrong in practice; nothing does that today.

## Secret handling

- Nothing sensitive is ever committed. `.env` is gitignored; `.env.example`
  documents the required variable names with placeholder values only.
- [gitleaks](https://github.com/gitleaks/gitleaks) runs in CI
  (`.github/workflows/gitleaks.yml`) on every push/PR, and again locally as a
  pre-commit hook (`.husky/pre-commit`) — the intent is to catch a leaked
  secret before it's ever committed, not just before it's merged.
- Caddy's local CA private key material lives under `infra/caddy/data/` and
  `infra/caddy/config/`, both gitignored — this key can mint trusted certs for
  the LAN and must never leave the machine.

## What's explicitly out of scope right now

- Multi-user auth / accounts — this is a single-operator tool.
- Internet-facing hardening (rate limiting beyond the basics, WAF, etc.) —
  not needed for a LAN-only tool, and adding it without also adding real
  internet exposure would be complexity for no benefit.
- The AI-agent API described in [API.md](./API.md) is a design target for a
  future milestone (M4) and carries its own auth requirements to be defined
  when it's actually implemented.

## Reporting a vulnerability

This is currently a private, personal repository. Once public, report issues
to **kevintrinhdev@gmail.com** rather than opening a public issue.
