# inkboard

A teaching-board recorder: draw and write on an iPad (as a Pencil input
surface, not a native app) while a facecam records you, for tutorial and note
videos. The board is never a bitmap — it's semantic data (typed text, LaTeX
math, ink strokes, arrows, shapes) that gets rendered into video only at
export time.

> **Status:** early-stage personal project, private repo. This README covers
> the M0 scaffold + proof-of-concept milestone — see
> [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

## Why semantic, not pixels

```
TEXT   "Newton's Second Law"
MATH   latex: "F = ma"
ARROW  points: [...]
INK    points: [...] pressure: [...]
```

Storing the board this way means it can be re-rendered at any resolution,
re-skinned with a different handwriting style later, or translated into other
languages and re-rendered — without ever touching a video frame. Full
rationale in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How it works

```
iPad (Safari PWA)                         Ubuntu XPS
─────────────────                         ──────────
Apple Pencil → tldraw canvas    HTTPS      Caddy (local HTTPS, LAN-only)
  → instant local render        WSS   →    Fastify server
  → journal event queued                     - serves the PWA
                                              - device pairing (QR)
Camera/mic preview + capture                 - WS signaling stub
                                              - upload-on-stop
                                            faster-whisper sidecar (M2)
```

The iPad is never a general-purpose client of some remote canvas — ink has to
render locally and instantly, with journal events replicated to the server
afterward. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full
system design and the reasoning behind each choice (tldraw over a custom
canvas engine, plain WebRTC P2P over an SFU, Caddy's local CA, etc.).

## Quickstart (LAN dev setup)

Requires Node 22+, [pnpm](https://pnpm.io), and [Caddy](https://caddyserver.com)
installed on the Ubuntu machine that will act as the server.

```bash
pnpm install

# one-time: generate + trust Caddy's local CA, prints iPad trust instructions
./infra/scripts/setup-local-ca.sh

# one-time: restrict inbound traffic to your LAN subnet
sudo ./infra/scripts/setup-ufw.sh

# start Caddy + the server + the client dev build
./infra/scripts/dev-up.sh
```

Then on the iPad:
1. Trust the printed CA certificate (Settings → General → VPN & Device
   Management → install the profile → Certificate Trust Settings → enable).
2. Open `https://inkboard.local` (or your `CADDY_DOMAIN`) in Safari.
3. Scan the pairing QR code printed in the terminal with the Camera app.
4. Add to Home Screen for a standalone installed app.

Full detail: [docs/SECURITY.md](docs/SECURITY.md) (pairing/trust model) and
[infra/caddy/README.md](infra/caddy/README.md) (the cert flow specifically).

## Repo layout

- `apps/client` — the iPad-facing PWA (Vite + React + tldraw).
- `apps/server` — the Fastify server that runs on the XPS.
- `packages/shared-schema` — the board object/event schema, imported by both
  the client and server (and the future agent API — see docs/API.md).
- `services/whisper-sidecar` — the faster-whisper CUDA sidecar (M2).
- `infra/` — Caddy config, firewall setup, dev scripts.
- `docs/` — [ARCHITECTURE.md](docs/ARCHITECTURE.md),
  [SECURITY.md](docs/SECURITY.md), [API.md](docs/API.md),
  [ROADMAP.md](docs/ROADMAP.md).

## License

MIT — see [LICENSE](LICENSE). Playpen Sans (used for handwriting-style text
rendering, from M5 onward) is bundled/referenced under its own OFL license.
