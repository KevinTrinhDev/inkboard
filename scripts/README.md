# scripts

Checks that run against a **live** server, complementing the unit and
integration tests in `pnpm test`. They exist because board sync is the kind of
thing that passes in a test harness and still fails on real sockets: the
failure modes are timing, backpressure, reconnects and frame limits.

Both read the pairing token from the server's own startup log, pair through the
real `POST /api/pair` handshake, and never print a credential.

## Running them

Start a server and capture its log, since the pairing QR token is printed
there once at startup:

```bash
pnpm build
node apps/server/dist/index.js > /tmp/inkboard.log 2>&1 &
```

Then:

```bash
node scripts/check-sync.mjs /tmp/inkboard.log     # correctness
node scripts/stress-sync.mjs /tmp/inkboard.log    # load and edge cases
```

Both exit non-zero on failure, so they can gate a release.

A pairing token is single-use, so each script needs a freshly started server.
Restart it between runs.

## check-sync.mjs

The happy path, end to end: pair, connect an `editor` and a `mirror`, prove a
stroke crosses from one to the other, prove the mirror is refused write access,
round-trip an uploaded image byte-for-byte, and prove a late joiner receives
the existing board.

## stress-sync.mjs

Load and edge cases:

- 2000 rapid diffs, asserting none are lost
- one editor fanning out to eight mirrors
- 40 connect/disconnect cycles
- a frame over the 8 MB cap, asserting it is refused rather than exhausting memory
- malformed frames, asserting the connection survives and stays responsive
- traffic sent before authenticating
- asset edge cases: SVG, missing credential, path traversal, oversized upload
- a late joiner receiving the full board after all that churn
