import { useEffect, useRef } from "react";

/**
 * Renders a live preview of an already-acquired stream. The stream itself is
 * owned by useRecordingRig (a single getUserMedia call feeds both this
 * preview and the preflight checklist's camera/mic checks) — see
 * docs/ARCHITECTURE.md.
 */
export function CameraPreview({
  stream,
  error,
}: {
  stream: MediaStream | null;
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  if (error) {
    return (
      <div style={{ color: "salmon", fontSize: 12 }}>
        Camera/mic unavailable: {error}
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{ width: 160, borderRadius: 8, background: "#000" }}
    />
  );
}
