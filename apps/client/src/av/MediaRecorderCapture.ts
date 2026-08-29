import { encryptBlob, getOrCreateRecordingKey } from "../crypto/recordingKey";
import { enqueueUpload } from "../recording/offlineQueue";

/**
 * M0 stand-in for live capture: records locally, encrypts on-device, and
 * queues the result for upload. Live WebRTC capture is M1: see
 * docs/ROADMAP.md.
 *
 * `stop()` deliberately does NOT touch the network itself: recording must
 * work with zero connectivity, so the only thing it depends on is local
 * disk (via IndexedDB). syncManager.ts owns actually reaching the server,
 * whenever a connection exists.
 */
/**
 * Container/codec pairs in preference order, most-preferred first.
 *
 * The WebM entries come first so desktop Chrome keeps recording exactly what
 * it recorded before. The MP4 entries exist for iPadOS Safari, which is the
 * actual target device and does not implement WebM in MediaRecorder at all:
 * it records H.264/AAC in MP4. Constructing a MediaRecorder with an
 * unsupported mimeType throws NotSupportedError synchronously, so the old
 * hardcoded "video/webm;codecs=vp9,opus" threw straight out of the record
 * button's click handler on every iPad, leaving the button apparently dead
 * while working perfectly on the developer's desktop.
 */
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];

/**
 * First candidate this browser can actually record, or undefined to let the
 * browser pick its own default rather than throwing.
 */
export function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export class MediaRecorderCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | undefined;

  constructor(
    private readonly stream: MediaStream,
    private readonly sessionId: string,
  ) {}

  start() {
    this.chunks = [];
    this.mimeType = pickSupportedMimeType();
    // Omit the option entirely when nothing matched, so the browser falls
    // back to its own default instead of being handed `undefined`.
    this.recorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream);
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

    // Tag the blob with what was actually recorded, not a hardcoded guess:
    // on Safari these chunks are MP4, and mislabelling them as WebM would
    // make the ciphertext undecodable by anything that trusts the type.
    const blob = new Blob(this.chunks, {
      type: this.mimeType ?? recorder.mimeType ?? "application/octet-stream",
    });
    const key = await getOrCreateRecordingKey();
    const encrypted = await encryptBlob(key, blob);
    await enqueueUpload(this.sessionId, encrypted);
  }
}
