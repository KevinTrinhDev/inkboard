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
  (`getUserMedia`) require a secure context, so this isn't optional: plain
  `http://<lan-ip>` will not work for camera/mic access.
- The iPad must trust that local CA once: install the CA certificate as a
  Configuration Profile (`Settings → General → VPN & Device Management →
  install profile`), then enable full trust
  (`Settings → General → About → Certificate Trust Settings`). See
  `infra/caddy/README.md` for the exact steps and `infra/scripts/setup-local-ca.sh`.
- The server's LAN hostname is an mDNS `.local` name (via Avahi, which ships
  with Ubuntu) rather than a raw DHCP IP, so the trusted cert and the PWA's
  "Add to Home Screen" bookmark keep working if the device's IP changes.
  Note: this requires actually configuring the alias (e.g. via
  `/etc/avahi/hosts`): Avahi only publishes the machine's real hostname by
  default, not an arbitrary name like `inkboard.local`.
- The Fastify process itself binds to `127.0.0.1` only, never `0.0.0.0`.
  Caddy (the only intended entry point) reaches it over loopback via
  `reverse_proxy 127.0.0.1:<port>`; nothing on the LAN can hit the app port
  directly and bypass TLS.

## Network access control

- `infra/scripts/setup-ufw.sh` restricts inbound connections on the server's
  ports to the local LAN subnet only, and denies all other inbound traffic by
  default. No port is ever forwarded through the home router.
- Being on the same Wi-Fi is **not** treated as sufficient authorization by
  itself: anyone else on that network (a guest, a compromised IoT device)
  would otherwise satisfy "same LAN." Device pairing (below) is the real gate.

## Device pairing (application-layer auth)

- On server startup, a short-lived pairing token is generated and printed as a
  QR code in the terminal (`qrcode-terminal`).
- The iPad scans it once with the Camera app; the client stores the resulting
  token and presents it on the WebSocket handshake and any API calls.
- Tokens are signed/verified using `PAIRING_TOKEN_SECRET` (see `.env.example`),
  generate a real value with `openssl rand -hex 32` and never commit it.
- A device that doesn't present a valid token cannot open the board, connect
  to the board sync WebSocket, upload or read session data, or store or fetch
  a pasted asset.
- Pairing (`POST /api/pair`) is separate from the credential used afterward:
  the scanned QR token is short-lived (5 minutes, single-use for pairing
  itself) but the credential it exchanges for is a distinct, longer-lived
  (30 day) session credential, signed with a domain-separated HMAC so
  neither can be replayed as the other. This split exists specifically so an
  offline recording session (see below) can still authenticate an upload
  hours or days later without forcing a re-pair.
- **Several devices can be paired at once, up to a fixed cap, enforced
  server-side.** The two-device setup is the normal case: the iPad holds the
  pen and the laptop shows the mirror, so both need a live credential at the
  same time. Each credential is tracked individually against an in-memory
  epoch (`tokens.ts`'s `activeSessions` map plus `currentEpoch`), capped at
  `MAX_ACTIVE_SESSIONS`. Pairing beyond the cap evicts the least recently
  paired device rather than refusing, because being locked out of your own
  board is a worse failure than dropping a stale device. Three consequences
  worth knowing:
  - `revokeAllSessions()` invalidates every outstanding credential in one
    call. It bumps the epoch as well as clearing the map, so a credential
    cannot be revived even if its nonce were somehow replayed.
  - Restarting the server invalidates every existing credential, since both
    the epoch and the map are in-memory. Every device must re-pair after a
    server restart. This is intentional: `PAIRING_TOKEN_SECRET` itself has no
    persistence guarantee across restarts either.
  - If a device has an offline recording still queued for upload when it gets
    evicted by the cap, that queued upload will 401. Re-pair that device and
    the queued upload retries on its own.

  This replaced an earlier single-active-session rule, where every pairing
  bumped a counter that verification required an exact match on. That rule
  made the product impossible: pairing the laptop silently revoked the iPad.

### Board sync socket

- The session credential is sent in the socket's first `hello` frame, never
  as a `?token=` query parameter. A query string is recorded by every
  intermediary that logs a URL, including Caddy's access log, so carrying a
  30-day bearer credential there would leak it well outside this application.
  The hub never logs frame contents for the same reason.
- A socket that does not authenticate within 10 seconds is closed.
- Roles are enforced on the server, not requested by the client in good
  faith: a `mirror` connection is refused if it sends a board mutation, so a
  tampered-with or buggy laptop cannot corrupt the board being drawn on.
- Frames are capped at 8 MB and validated against the shared zod protocol
  before anything acts on them.

### Pasted assets

- `POST /api/assets` requires a valid session credential.
- Accepted media types are an allowlist. **SVG is deliberately excluded**: it
  is script-capable, and an SVG served same-origin and rendered on the board
  would be stored XSS against the board itself.
- Uploads are bounded by a streaming byte counter, not just `content-length`,
  because a chunked upload sends no `content-length` at all.
- Asset ids are server-generated. A request for anything that is not a
  well-formed generated id is rejected before touching the filesystem, and
  responses carry `X-Content-Type-Options: nosniff`.

## Offline recording

inkboard is offline-first: recording never depends on the signaling
WebSocket or any network reachability, only on local device storage.

- Pencil/camera/mic/disk are the only pre-flight gates on REC.
  `serverConnected` is shown in the UI but is informational only: dropping
  Wi-Fi mid-lesson does not stop or block a recording.
- A finished take is encrypted on-device (see "Encryption at rest" below)
  and written to the iPad's IndexedDB immediately, before any network
  attempt. It only ever leaves the device once a connection to the XPS
  actually exists.
- A background sync loop retries every 15 seconds and on the browser's
  `online` event, uploading anything still queued. The toolbar shows a
  "waiting to sync" count so the operator knows what hasn't reached the
  server yet.
- True Bluetooth/no-network live transport isn't possible for this use case:
  a camera feed needs far more bandwidth than Bluetooth (Classic or BLE)
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
  the resulting `.webm.enc` file exactly as received: it never possesses
  the key and cannot decrypt it.
- Practical effect: someone with access to the XPS (theft, another local
  user, a backup that leaks) gets only ciphertext. Only the iPad that
  recorded a given session can decrypt it.
- Trade-off, stated plainly: this key has no recovery mechanism by design.
  If the iPad resets, its browser storage is cleared, or the device is
  lost, every recording encrypted with that key becomes permanently
  unreadable: there is no backdoor and no export of the key today. A
  future milestone could add an explicit "export/back up this key" flow if
  that trade-off turns out to be wrong in practice; nothing does that today.

## Secret handling

- Nothing sensitive is ever committed. `.env` is gitignored; `.env.example`
  documents the required variable names with placeholder values only.
- [gitleaks](https://github.com/gitleaks/gitleaks) runs in CI
  (`.github/workflows/gitleaks.yml`) on every push/PR, and again locally as a
  pre-commit hook (`.husky/pre-commit`): the intent is to catch a leaked
  secret before it's ever committed, not just before it's merged.
- Caddy's local CA private key material lives under `infra/caddy/data/` and
  `infra/caddy/config/`, both gitignored: this key can mint trusted certs for
  the LAN and must never leave the machine.

## Known limitations

Found in an independent review of the board-sync work and deliberately not
fixed, rather than overlooked. Both are acceptable on a single-operator LAN
tool and would not be on anything internet-facing.

### An asset URL is a capability

`GET /api/assets/:id` does not check a credential, unlike the upload. This is
forced by how the board renders images: the browser fetches them as ordinary
`<img src>` subresources, which cannot carry an `Authorization` header. So the
unguessable id in the URL is what protects the file.

The consequences: anyone on the LAN who obtains an asset URL can read that
file, including after their own credential has been revoked, and the URL does
not expire. Ids are random UUIDs, so blind enumeration is impractical. Signed,
expiring asset URLs are the real fix if this ever needs to be tighter.

### Board and asset storage are unbounded

The 8 MB cap is per WebSocket frame, not per board. Nothing evicts old board
records or deletes assets, and no quota is enforced across a session:

- a long lesson with many pasted images or videos grows the assets directory
  until the disk fills;
- the board record map grows in memory and is re-serialized to JSON on every
  save, and sent in full to every device that connects.

For one person teaching on their own laptop this is a housekeeping matter, not
an attack. A paired device that turns hostile could fill the disk deliberately,
which is worth knowing but is the same trust level that already lets it draw on
the board. Session-scoped boards and asset garbage collection are the fix, and
belong with the session storage work in [ROADMAP.md](./ROADMAP.md).

## What's explicitly out of scope right now

- Multi-user auth / accounts: this is a single-operator tool.
- Internet-facing hardening (rate limiting beyond the basics, WAF, etc.):
  not needed for a LAN-only tool, and adding it without also adding real
  internet exposure would be complexity for no benefit.
- The AI-agent API described in [API.md](./API.md) is a design target for a
  future milestone (M4) and carries its own auth requirements to be defined
  when it's actually implemented.

## Reporting a vulnerability

This is currently a private, personal repository. Once public, report issues
to **kevintrinhdev@gmail.com** rather than opening a public issue.
