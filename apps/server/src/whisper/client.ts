/**
 * Client for the faster-whisper sidecar (services/whisper-sidecar). Deferred
 * to M2: see docs/ROADMAP.md. Left as a typed stub so apps/server's shape
 * doesn't need to change when the sidecar is wired up.
 */
export interface TranscribeResult {
  text: string;
}

export async function transcribe(_audio: Buffer): Promise<TranscribeResult> {
  throw new Error(
    "whisper sidecar not wired up yet (M2): see services/whisper-sidecar/README.md",
  );
}
