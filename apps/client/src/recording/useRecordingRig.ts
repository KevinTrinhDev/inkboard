import { useCallback, useEffect, useRef, useState } from "react";
import { MediaRecorderCapture } from "../av/MediaRecorderCapture";
import { startSyncLoop } from "./syncManager";

export interface PreflightState {
  pencilReady: boolean;
  cameraReady: boolean;
  /** True while the mic is picking up sound right now: a live level light. */
  micActive: boolean;
  /**
   * True once the mic has produced *any* sound since it was acquired, and
   * latched from then on. `micActive` alone used to gate the record button,
   * which meant REC enabled and disabled itself as the operator spoke and
   * paused: the button could go dead under the cursor mid-click, and on a
   * Linux box whose default input is a muted or wrong device it never
   * enabled at all, with nothing on screen explaining why.
   */
  micReady: boolean;
  serverConnected: boolean;
  diskOk: boolean;
}

export interface RecordingRig {
  /** True on the device that owns the camera and mic (the laptop mirror). */
  capture: boolean;
  stream: MediaStream | null;
  cameraError: string | null;
  /** Re-runs camera/mic acquisition after a failure the operator has fixed. */
  retryCamera: () => void;
  /** Non-null when the last take failed to encrypt or queue and was lost. */
  saveError: string | null;
  preflight: PreflightState;
  readyToRecord: boolean;
  isRecording: boolean;
  elapsedMs: number;
  pendingSyncCount: number;
  previewVisible: boolean;
  togglePreview: () => void;
  toggleRecording: () => void;
}

// A "session" is one continuous recording take, so the id has to be minted
// per take rather than per app load. It used to be a module-level constant
// shared by every take, and the offline queue is keyed on it
// (offlineQueue.ts createObjectStore(..., { keyPath: "sessionId" })), so
// IndexedDB `put` silently replaced the previous take: record segment one
// with the network down, record segment two, and segment one was gone with
// no error and the pending count still reading 1. The server collided the
// same way, writing every take to the same `${id}.webm.enc` path.
const MIN_FREE_BYTES = 500 * 1024 * 1024; // rough "enough room for a take"
const MIC_ACTIVE_RMS_THRESHOLD = 0.02;
const MIC_ACTIVE_HOLD_MS = 2000;
// Purely informational in the checklist, so a slow cadence is plenty.
const SERVER_PROBE_INTERVAL_MS = 5000;

/**
 * Turns a getUserMedia rejection into something a human can act on.
 *
 * The old handler was `String(err)`, which rendered
 * "NotReadableError: Could not start video source" in a 160px-wide box and
 * offered no hint that the fix is to close whatever else is using the camera.
 */
export function describeMediaError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Permission denied. Allow camera and microphone for this site, then click Retry.";
    case "NotFoundError":
      return "No camera or microphone found. Plug one in, then click Retry.";
    case "NotReadableError":
      return "Another app is using the camera. Close Zoom/Meet/OBS, then click Retry.";
    case "OverconstrainedError":
      return "No device matches the requested settings.";
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Owns the camera/mic stream and every signal the pre-flight checklist
 * depends on (pencil touch seen, camera live, mic actually picking up sound,
 * signaling socket reachable, disk headroom), plus starting/stopping the
 * MediaRecorder capture. See docs/BACKLOG.md's "Now, UI/UX" item.
 *
 * Recording itself never depends on `serverConnected`: inkboard is
 * offline-first (see docs/ARCHITECTURE.md "Offline recording"). A finished
 * take is encrypted and queued locally regardless of connectivity, and
 * syncManager.ts uploads it whenever a connection to the server actually
 * exists. `serverConnected` stays purely informational in the checklist.
 */
export function useRecordingRig(
  pairingToken: string | null,
  onCredentialInvalid: () => void = () => {},
  /**
   * Whether this device does the capturing. The laptop holds the camera and
   * mic; the iPad is the drawing surface and must never be prompted for
   * camera access it has no use for. A denied prompt on the iPad would also
   * leave cameraError set forever on a device that was never going to record.
   */
  capture = true,
): RecordingRig {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pencilReady, setPencilReady] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micReady, setMicReady] = useState(false);
  // Bumped to force re-acquisition after the operator fixes whatever broke
  // (closed the app holding the webcam, granted permission, plugged it in).
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [serverConnected, setServerConnected] = useState(false);
  const [diskOk, setDiskOk] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(true);
  // Set when a take fails to encrypt or queue, so a lost recording is not
  // indistinguishable from a saved one. See toggleRecording's catch.
  const [saveError, setSaveError] = useState<string | null>(null);
  const captureRef = useRef<MediaRecorderCapture | null>(null);
  const syncRef = useRef<ReturnType<typeof startSyncLoop> | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!capture) return;

    let cancelled = false;
    let acquired: MediaStream | undefined;

    // getUserMedia only exists in a secure context. Over plain http on a LAN
    // IP - easy to hit by opening the Fastify port directly instead of going
    // through Caddy - `navigator.mediaDevices` is undefined, and reading
    // .getUserMedia off it threw a synchronous TypeError from inside this
    // effect. That escapes the promise chain below, so there was nothing to
    // .catch() it and React unmounted the whole tree: a blank white page with
    // no message. Say what is actually wrong instead.
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera and mic need a secure connection. Open this page over https:// " +
          "(the address the server printed), not http://.",
      );
      return;
    }

    // Audio and video are requested separately and recombined. A single
    // combined call fails as a unit: if another app holds the webcam (Zoom,
    // Meet in another tab, OBS, a stale headless Chrome - routine on Linux),
    // Chrome rejects with NotReadableError and the microphone is denied along
    // with it even though the mic was free. Acquiring them independently
    // means a busy camera costs you the camera, not the whole session.
    const acquire = async (): Promise<MediaStream> => {
      const [videoResult, audioResult] = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({ video: true }),
        navigator.mediaDevices.getUserMedia({ audio: true }),
      ]);

      const tracks: MediaStreamTrack[] = [];
      if (videoResult.status === "fulfilled") tracks.push(...videoResult.value.getTracks());
      if (audioResult.status === "fulfilled") tracks.push(...audioResult.value.getTracks());

      if (tracks.length === 0) {
        const reason =
          videoResult.status === "rejected" ? videoResult.reason : audioResult.status === "rejected" ? audioResult.reason : undefined;
        throw reason instanceof Error ? reason : new Error("Camera and mic unavailable.");
      }

      // A partial success is still usable, but say so rather than letting a
      // silent audio failure look like a working setup that records mute.
      if (videoResult.status === "rejected") {
        setCameraError(`Camera unavailable (${describeMediaError(videoResult.reason)}). Recording audio only.`);
      } else if (audioResult.status === "rejected") {
        setCameraError(`Microphone unavailable (${describeMediaError(audioResult.reason)}). Recording video only.`);
      } else {
        setCameraError(null);
      }

      return new MediaStream(tracks);
    };

    acquire()
      .then((got) => {
        if (cancelled) {
          got.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = got;
        setStream(got);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCameraError(describeMediaError(err));
      });

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
    };
  }, [capture, cameraAttempt]);

  const retryCamera = useCallback(() => {
    setCameraError(null);
    setStream(null);
    setCameraAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;

    const audioCtx = new AudioContext();

    // iOS Safari starts an AudioContext constructed outside a user gesture in
    // the "suspended" state and leaves it there. A suspended analyser reports
    // a flat 128 for every sample, so rms is always 0, micActive never turns
    // true, and readyToRecord below is false forever: on a real iPad the
    // operator sits in front of a preflight checklist that can never go
    // green. Resume immediately (sufficient on desktop) and again on the
    // first genuine user gesture, which is the only point iOS honours it.
    const resumeAudio = () => {
      if (audioCtx.state === "suspended") {
        void audioCtx.resume().catch(() => {
          // Nothing useful to do: the next gesture gets another attempt.
        });
      }
    };
    resumeAudio();

    const GESTURES = ["pointerdown", "touchend", "keydown"] as const;
    for (const gesture of GESTURES) {
      window.addEventListener(gesture, resumeAudio, { passive: true });
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let rafId: number;
    let lastLoudAt = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      if (rms > MIC_ACTIVE_RMS_THRESHOLD) {
        lastLoudAt = performance.now();
        // Latched: once the mic has demonstrably worked, it counts as ready
        // for the rest of the session even during silence. See micReady.
        setMicReady(true);
      }
      setMicActive(performance.now() - lastLoudAt < MIC_ACTIVE_HOLD_MS);
      rafId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      for (const gesture of GESTURES) {
        window.removeEventListener(gesture, resumeAudio);
      }
      source.disconnect();
      void audioCtx.close();
    };
  }, [stream]);

  useEffect(() => {
    if (pencilReady) return;
    // Safari only reports pointerType "pen" for a genuine Apple Pencil:
    // third-party/passive styluses (and a finger) register as "touch",
    // same as any other touch input. Accepting "touch" too means a
    // non-Apple stylus (or finger-drawing) isn't permanently blocked from
    // ever satisfying this checklist item; it can't detect pressure-
    // sensitive ink either way, but that's a hardware limit, not a reason
    // to lock the operator out of recording entirely. Confirmed against
    // real hardware: a third-party stylus never fires pointerType "pen".
    const onPointerDown = (event: PointerEvent) => {
      // "mouse" counts too: on the laptop this is only ever an indicator
      // that some input device has been seen, and leaving it permanently
      // grey there was misread as a hardware fault.
      if (
        event.pointerType === "pen" ||
        event.pointerType === "touch" ||
        event.pointerType === "mouse"
      ) {
        setPencilReady(true);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [pencilReady]);

  // Reachability only, deliberately not a second WebSocket. The board sync
  // hub (useBoardSync) owns the one socket this app opens; a second one here
  // would double-count peers and, since it authenticated via ?token= rather
  // than the hello frame, would now be rejected outright. /healthz needs no
  // credential, so this also keeps a stale credential from being reported as
  // "server unreachable".
  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      try {
        const res = await fetch("/healthz", { cache: "no-store" });
        if (!cancelled) setServerConnected(res.ok);
      } catch {
        if (!cancelled) setServerConnected(false);
      }
    };

    void probe();
    const interval = window.setInterval(probe, SERVER_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!pairingToken) return;
    const sync = startSyncLoop(() => pairingToken, setPendingSyncCount, onCredentialInvalid);
    syncRef.current = sync;
    return () => {
      sync.stop();
      syncRef.current = null;
    };
  }, [pairingToken, onCredentialInvalid]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        if (!navigator.storage?.estimate) {
          if (!cancelled) setDiskOk(true); // can't determine, don't block on it
          return;
        }
        const { quota, usage } = await navigator.storage.estimate();
        const free = (quota ?? 0) - (usage ?? 0);
        if (!cancelled) setDiskOk(free > MIN_FREE_BYTES);
      } catch {
        if (!cancelled) setDiskOk(true);
      }
    }
    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const preflight: PreflightState = {
    pencilReady,
    cameraReady: stream !== null && cameraError === null,
    micActive,
    micReady,
    serverConnected,
    diskOk,
  };

  // Deliberately excludes `serverConnected`: inkboard records with zero
  // network and syncs later. See the doc comment above.
  //
  // Also excludes `pencilReady`. That signal is about the *drawing* device,
  // but this hook only runs its capture half on the laptop, where input is a
  // mouse or trackpad and the pointerdown listener below never sees "pen" or
  // "touch". Gating on it meant the record button on the only device that
  // owns a camera was disabled permanently, with a dim dot and no
  // explanation. It stays in the checklist as information; it is not a gate.
  const readyToRecord =
    preflight.cameraReady && preflight.micReady && preflight.diskOk;

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      if (recordingStartedAtRef.current !== null) {
        setElapsedMs(Date.now() - recordingStartedAtRef.current);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [isRecording]);

  // A take exists only in this tab until it is stopped, so closing or
  // reloading mid-recording silently destroys it. Make the browser ask.
  useEffect(() => {
    if (!isRecording) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers require returnValue to be set for the prompt to show.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isRecording]);

  function toggleRecording() {
    if (!stream || !pairingToken) return;

    if (isRecording) {
      // stop() can reject at key access (IndexedDB blocked in private
      // browsing), at encryption, or at enqueue (storage quota, very
      // plausible for a GB-scale take). Without this catch the rejection was
      // unhandled, the take was discarded, and the UI still showed a clean
      // stop, so a lost recording looked exactly like a saved one.
      void captureRef.current
        ?.stop()
        .then(() => {
          setSaveError(null);
          syncRef.current?.flushNow();
        })
        .catch((err: unknown) => {
          console.error("inkboard: recording failed to save", err);
          setSaveError(
            err instanceof Error ? err.message : "Recording failed to save.",
          );
        });
      captureRef.current = null;
      recordingStartedAtRef.current = null;
      setIsRecording(false);
      setElapsedMs(0);
      return;
    }

    // Constructing a MediaRecorder, and start() itself, can throw
    // synchronously: an unsupported mimeType, a stream whose tracks have
    // already ended, or no MediaRecorder at all. Uncaught, that propagated
    // straight out of the button's click handler, so the button looked dead
    // and nothing on screen said why.
    try {
      const takeId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `take-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const capture = new MediaRecorderCapture(stream, takeId);
      capture.start();
      captureRef.current = capture;
      recordingStartedAtRef.current = Date.now();
      setElapsedMs(0);
      setSaveError(null);
      setIsRecording(true);
    } catch (err: unknown) {
      console.error("inkboard: could not start recording", err);
      setSaveError(
        err instanceof Error ? err.message : "Could not start recording.",
      );
    }
  }

  function togglePreview() {
    setPreviewVisible((visible) => !visible);
  }

  return {
    capture,
    stream,
    cameraError,
    retryCamera,
    saveError,
    preflight,
    readyToRecord,
    isRecording,
    elapsedMs,
    pendingSyncCount,
    previewVisible,
    togglePreview,
    toggleRecording,
  };
}
