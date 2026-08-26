# whisper-sidecar (M2: not wired up yet)

A long-lived local HTTP server wrapping `faster-whisper` with CUDA, so the
model stays warm in GPU memory between "tap the text tool, speak a phrase"
invocations from the client. Deliberately kept as a separate Python process
outside the pnpm workspace rather than shelled-out-to per call: see
docs/ARCHITECTURE.md ("Transcription: faster-whisper with CUDA").

## Setup (when this milestone starts)

Targets the XPS's NVIDIA GPU (RTX 3050 Ti Laptop) via CUDA + cuDNN.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Scope for M2

- Bind to `127.0.0.1` only: never exposed beyond localhost, the Fastify
  server (`apps/server/src/whisper/client.ts`) is the only caller.
- Load the model once at startup, keep it resident.
- One endpoint: accept a short audio clip, return transcribed text.
- Wire `apps/server/src/whisper/client.ts` to call it instead of throwing.

Not scoped for M2: streaming/partial transcription, multi-language
auto-detect (start with a fixed language), long-form transcription.
