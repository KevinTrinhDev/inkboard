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

/**
 * How often MediaRecorder hands back a chunk. Without a timeslice it fires
 * ondataavailable exactly once, at stop(), so nothing at all exists until the
 * take ends and any crash loses 100% of it. A periodic flush also keeps each
 * individual Blob small.
 */
const TIMESLICE_MS = 5000;

export class MediaRecorderCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | undefined;
  /** Set if the recorder itself errored, so stop() can report it. */
  private recorderError: Error | null = null;

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
    // Without this, an encoder failure or a camera yanked mid-take went
    // completely unnoticed: the elapsed timer kept counting up as if all was
    // well and the take was quietly empty.
    this.recorder.onerror = (event: Event) => {
      const err = (event as unknown as { error?: Error }).error;
      this.recorderError = err ?? new Error("Recording stopped unexpectedly.");
      console.error("inkboard: MediaRecorder error", this.recorderError);
    };
    this.recorder.start(TIMESLICE_MS);
  }

  /** True once start() has been called and stop() has not consumed it yet. */
  get active(): boolean {
    return this.recorder !== null;
  }

  /**
   * Finishes the take, encrypts it and queues it for upload.
   *
   * Resolves with null when the take is clean, or with a human-readable
   * warning when it was saved but is known to be incomplete. Throwing on a
   * partial take would be worse than returning one: the chunks are real
   * footage and discarding them helps nobody. Staying silent would be worse
   * still, which is what used to happen: if the encoder failed after the
   * first timeslice, `recorderError` was set and then dropped on the floor,
   * so a truncated take was reported to the operator as a clean save.
   */
  async stop(): Promise<string | null> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("not recording");

    // When every track ends (webcam unplugged, USB reset) the recorder moves
    // to "inactive" on its own. Calling stop() on it then throws
    // InvalidStateError and the onstop promise never settles, so the take
    // hung forever and the chunks already buffered were thrown away. Only
    // wait for onstop if there is actually something to stop.
    if (recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      try {
        recorder.stop();
        await stopped;
      } catch (err) {
        // Salvage whatever was captured rather than losing the take.
        console.error("inkboard: recorder.stop() failed, saving buffered chunks", err);
      }
    }

    this.recorder = null;

    if (this.chunks.length === 0) {
      throw this.recorderError ?? new Error("Nothing was recorded.");
    }

    // Tag the blob with what was actually recorded, not a hardcoded guess:
    // on Safari these chunks are MP4, and mislabelling them as WebM would
    // make the ciphertext undecodable by anything that trusts the type.
    const mime = this.mimeType ?? recorder.mimeType ?? "video/webm";
    const blob = new Blob(this.chunks, { type: mime });
    const key = await getOrCreateRecordingKey();
    const encrypted = await encryptBlob(key, blob);
    // The real container rides with the take so the sidecar on the server
    // can tell the recording device what format to decrypt back into.
    await enqueueUpload(this.sessionId, encrypted, mime);

    return this.recorderError
      ? `Recording was saved but is incomplete: ${this.recorderError.message}`
      : null;
  }
}
