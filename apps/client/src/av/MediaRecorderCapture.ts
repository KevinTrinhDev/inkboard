/**
 * M0 stand-in for live capture: records locally and uploads the blob on
 * stop. Live WebRTC capture is M1 — see docs/ROADMAP.md.
 */
export class MediaRecorderCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(
    private readonly stream: MediaStream,
    private readonly sessionId: string,
    private readonly pairingToken: string,
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

  async stop(): Promise<Response> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("not recording");

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    const blob = new Blob(this.chunks, { type: "video/webm" });
    return fetch(`/api/sessions/${this.sessionId}/upload`, {
      method: "POST",
      headers: { "x-pairing-token": this.pairingToken },
      body: blob,
    });
  }
}
