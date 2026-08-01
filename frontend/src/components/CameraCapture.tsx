import { useEffect, useRef, useState } from "react";
import type { Strings } from "../lib/i18n";

interface CameraCaptureProps {
  t: Strings;
  onCapture: (blob: Blob) => void;
  /** Called instead of onCapture when several photos are picked at once. */
  onCaptureMany?: (files: File[]) => void;
  previewUrl: string | null;
  busy: boolean;
}

export function CameraCapture({ t, onCapture, onCaptureMany, previewUrl, busy }: CameraCaptureProps) {
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
      setError(t.captureNoCamera);
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
    const files = [...(e.target.files ?? [])];
    // A day's worth of photos in one go means one patient per file; a single
    // file stays on the one-patient path.
    if (files.length > 1 && onCaptureMany) onCaptureMany(files);
    else if (files[0]) onCapture(files[0]);
    e.target.value = "";
  }

  return (
    <div className="capture-card">
      <h3>{t.captureLabel}</h3>
      <p className="hint">{t.captureHint}</p>

      {previewUrl && !streaming && (
        <img src={previewUrl} alt={t.captureLabel} className="preview" />
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
            {previewUrl ? t.captureRetake : t.captureUseCamera}
          </button>
        ) : (
          <button type="button" onClick={capture} disabled={busy}>
            {t.captureTake}
          </button>
        )}
        <label className="upload-btn">
          {t.captureUpload}
          <input
            type="file"
            accept="image/*"
            multiple={onCaptureMany !== undefined}
            onChange={handleFile}
            disabled={busy}
          />
        </label>
      </div>

      {busy && <p className="hint">{t.captureBusy}</p>}
      {onCaptureMany && !busy && <p className="hint">{t.batchUploadHint}</p>}
    </div>
  );
}
