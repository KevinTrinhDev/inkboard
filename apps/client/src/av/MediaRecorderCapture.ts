import { encryptBlob, getOrCreateRecordingKey } from "../crypto/recordingKey";
import { enqueueUpload } from "../recording/offlineQueue";

/**
 * M0 stand-in for live capture: records locally, encrypts on-device, and
 * queues the result for upload. Live WebRTC capture is M1 — see
 * docs/ROADMAP.md.
 *
 * `stop()` deliberately does NOT touch the network itself: recording must
 * work with zero connectivity, so the only thing it depends on is local
 * disk (via IndexedDB). syncManager.ts owns actually reaching the server,
 * whenever a connection exists.
 */
export class MediaRecorderCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(
    private readonly stream: MediaStream,
    private readonly sessionId: string,
  ) {}

  start() {
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: "video/webm;codecs=vp9,opus",
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("not recording");

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    const blob = new Blob(this.chunks, { type: "video/webm" });
    const key = await getOrCreateRecordingKey();
    const encrypted = await encryptBlob(key, blob);
    await enqueueUpload(this.sessionId, encrypted);
  }
}
