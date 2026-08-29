import { useEffect, useRef, useState } from "react";
import { MediaRecorderCapture } from "../av/MediaRecorderCapture";
import { startSyncLoop } from "./syncManager";

export interface PreflightState {
  pencilReady: boolean;
  cameraReady: boolean;
  micActive: boolean;
  serverConnected: boolean;
  diskOk: boolean;
}

export interface RecordingRig {
  stream: MediaStream | null;
  cameraError: string | null;
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
): RecordingRig {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pencilReady, setPencilReady] = useState(false);
  const [micActive, setMicActive] = useState(false);
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
    let cancelled = false;
    let acquired: MediaStream | undefined;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((got) => {
        if (cancelled) {
          got.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = got;
        setStream(got);
      })
      .catch((err) => setCameraError(String(err)));

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
    };
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
      if (rms > MIC_ACTIVE_RMS_THRESHOLD) lastLoudAt = performance.now();
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
      if (event.pointerType === "pen" || event.pointerType === "touch") {
        setPencilReady(true);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [pencilReady]);

  useEffect(() => {
    if (!pairingToken) return;

    const url = new URL("/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", pairingToken);
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => setServerConnected(true));
    ws.addEventListener("close", (event) => {
      setServerConnected(false);
      // 4401 means the server actively rejected this credential (expired,
      // or revoked by a newer device pairing), not just a dropped
      // connection. Bounce back to the pairing screen instead of sitting
      // there showing "Offline" forever with no way to tell why or fix it.
      if (event.code === 4401) onCredentialInvalid();
    });
    ws.addEventListener("error", () => setServerConnected(false));

    return () => ws.close();
  }, [pairingToken, onCredentialInvalid]);

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
    serverConnected,
    diskOk,
  };

  // Deliberately excludes `serverConnected`: inkboard records with zero
  // network and syncs later. See the doc comment above.
  const readyToRecord =
    preflight.pencilReady && preflight.cameraReady && preflight.micActive && preflight.diskOk;

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      if (recordingStartedAtRef.current !== null) {
        setElapsedMs(Date.now() - recordingStartedAtRef.current);
      }
    }, 250);
    return () => clearInterval(interval);
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

    const capture = new MediaRecorderCapture(stream, crypto.randomUUID());
    capture.start();
    captureRef.current = capture;
    recordingStartedAtRef.current = Date.now();
    setElapsedMs(0);
    setIsRecording(true);
  }

  function togglePreview() {
    setPreviewVisible((visible) => !visible);
  }

  return {
    stream,
    cameraError,
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
