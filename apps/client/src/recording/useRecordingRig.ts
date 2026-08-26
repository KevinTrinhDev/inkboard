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
  preflight: PreflightState;
  readyToRecord: boolean;
  isRecording: boolean;
  pendingSyncCount: number;
  toggleRecording: () => void;
}

// One id per app load — a "session" is one continuous recording take (or a
// board opened to draw on). Real multi-take session management is M1.
const SESSION_ID = crypto.randomUUID();
const MIN_FREE_BYTES = 500 * 1024 * 1024; // rough "enough room for a take"
const MIC_ACTIVE_RMS_THRESHOLD = 0.02;
const MIC_ACTIVE_HOLD_MS = 2000;

/**
 * Owns the camera/mic stream and every signal the pre-flight checklist
 * depends on (pencil touch seen, camera live, mic actually picking up sound,
 * signaling socket reachable, disk headroom), plus starting/stopping the
 * MediaRecorder capture. See docs/BACKLOG.md's "Now — UI/UX" item.
 *
 * Recording itself never depends on `serverConnected` — inkboard is
 * offline-first (see docs/ARCHITECTURE.md "Offline recording"): a finished
 * take is encrypted and queued locally regardless of connectivity, and
 * syncManager.ts uploads it whenever a connection to the server actually
 * exists. `serverConnected` stays purely informational in the checklist.
 */
export function useRecordingRig(pairingToken: string | null): RecordingRig {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pencilReady, setPencilReady] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const [diskOk, setDiskOk] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const captureRef = useRef<MediaRecorderCapture | null>(null);
  const syncRef = useRef<ReturnType<typeof startSyncLoop> | null>(null);

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
      source.disconnect();
      void audioCtx.close();
    };
  }, [stream]);

  useEffect(() => {
    if (pencilReady) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "pen") setPencilReady(true);
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
    ws.addEventListener("close", () => setServerConnected(false));
    ws.addEventListener("error", () => setServerConnected(false));

    return () => ws.close();
  }, [pairingToken]);

  useEffect(() => {
    if (!pairingToken) return;
    const sync = startSyncLoop(() => pairingToken, setPendingSyncCount);
    syncRef.current = sync;
    return () => {
      sync.stop();
      syncRef.current = null;
    };
  }, [pairingToken]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        if (!navigator.storage?.estimate) {
          if (!cancelled) setDiskOk(true); // can't determine — don't block on it
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

  // Deliberately excludes `serverConnected` — inkboard records with zero
  // network and syncs later. See the doc comment above.
  const readyToRecord =
    preflight.pencilReady && preflight.cameraReady && preflight.micActive && preflight.diskOk;

  function toggleRecording() {
    if (!stream || !pairingToken) return;

    if (isRecording) {
      void captureRef.current?.stop().then(() => syncRef.current?.flushNow());
      captureRef.current = null;
      setIsRecording(false);
      return;
    }

    const capture = new MediaRecorderCapture(stream, SESSION_ID);
    capture.start();
    captureRef.current = capture;
    setIsRecording(true);
  }

  return {
    stream,
    cameraError,
    preflight,
    readyToRecord,
    isRecording,
    pendingSyncCount,
    toggleRecording,
  };
}
