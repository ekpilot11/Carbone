import { useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  label: string;
  hint: string;
  onCapture: (blob: Blob) => void;
  previewUrl: string | null;
  busy: boolean;
}

export function CameraCapture({ label, hint, onCapture, previewUrl, busy }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => stopCamera, []);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch {
      setError("Couldn't access the camera. You can upload a photo instead.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreaming(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob);
    }, "image/jpeg", 0.92);
    stopCamera();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
    e.target.value = "";
  }

  return (
    <div className="capture-card">
      <h3>{label}</h3>
      <p className="hint">{hint}</p>

      {previewUrl && !streaming && (
        <img src={previewUrl} alt={`${label} preview`} className="preview" />
      )}

      {streaming && (
        <div className="video-wrap">
          <video ref={videoRef} playsInline muted className="preview" />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="capture-actions">
        {!streaming ? (
          <button type="button" onClick={startCamera} disabled={busy}>
            {previewUrl ? "Retake with camera" : "Use camera"}
          </button>
        ) : (
          <button type="button" onClick={capture} disabled={busy}>
            Capture
          </button>
        )}
        <label className="upload-btn">
          Upload photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFile}
            disabled={busy}
          />
        </label>
      </div>

      {busy && <p className="hint">Reading numbers from the photo…</p>}
    </div>
  );
}
