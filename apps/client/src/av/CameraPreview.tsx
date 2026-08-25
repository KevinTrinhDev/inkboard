import { useEffect, useRef, useState } from "react";

/**
 * getUserMedia preview. Proves camera/mic permission works inside the
 * *installed* PWA context, not just a Safari tab — iOS treats persisted
 * permissions differently between the two. See docs/ARCHITECTURE.md.
 */
export function CameraPreview({
  onStream,
}: {
  onStream?: (stream: MediaStream) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        onStream?.(s);
      })
      .catch((err) => setError(String(err)));

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onStream]);

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
