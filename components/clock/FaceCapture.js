"use client";

import { useEffect, useRef, useState } from "react";
import { acquireClockCamera } from '@/lib/clock-camera';
import { captureJpegBlob, createFaceDetector } from "@/lib/face-detect";

export default function FaceCapture({ actionLabel = "Take photo", onCaptured, onCancel, busy = false }) {
  const videoRef = useRef(null);
  const faceRef = useRef({ found: false, at: 0 });
  const captureLock = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false, stream, timer;
    setReady(false);setCameraError('');faceRef.current={found:false,at:0};
    const camera=acquireClockCamera();
    const detectorPromise = createFaceDetector().catch(() => null);
    async function start() {
      try {
        stream = await camera.ready;
        if (cancelled) return;
        const track = stream.getVideoTracks()[0];
        const zoom = track.getCapabilities?.().zoom;
        if (zoom && Number.isFinite(zoom.min)) {
          // Browser-controlled zoom only; do not crop the camera's native frame.
          try { await track.applyConstraints({ advanced: [{ zoom: zoom.min }] }); } catch { /* optional */ }
        }
        if (cancelled) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setReady(video.readyState >= 2 && video.videoWidth > 0);
        const detector = await detectorPromise;
        if (!detector) return;
        const canvas = document.createElement("canvas");
        async function tick() {
          if (cancelled) return;
          if (captureLock.current) { timer = window.setTimeout(tick, 750); return; }
          if (video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              try {
                const found = await detector.detect(canvas);
                if (!cancelled) faceRef.current = { found: Boolean(found), at: performance.now() };
              } catch { /* Photo capture remains available if detection is unavailable. */ }
            }
          }
          if (!cancelled) timer = window.setTimeout(tick, 750);
        }
        tick();
      } catch (err) {
        if (!cancelled) setCameraError(err?.name==='NotAllowedError'
          ? 'Camera access is blocked. In Safari, open the page menu → Website Settings → Camera → Allow, then try again.'
          : err?.message || 'Camera unavailable. Try again.');
      }
    }
    start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      camera.release();
    };
  }, [attempt]);
  useEffect(()=>{
    const visible=()=>{if(document.visibilityState==='visible')setAttempt(value=>value+1);else setReady(false);};
    document.addEventListener('visibilitychange',visible);
    return ()=>document.removeEventListener('visibilitychange',visible);
  }, []);

  async function capture() {
    if (!ready || busy || captureLock.current) return;
    captureLock.current = true; setCapturing(true); setCameraError("");
    try {
      const face = faceRef.current;
      const blob = await captureJpegBlob(videoRef.current);
      await onCaptured(blob, face.found && performance.now() - face.at < 1500);
    } catch (err) {
      setCameraError(err?.message || "Could not capture photo. Try again.");
    } finally { captureLock.current = false; setCapturing(false); }
  }
  const locked = busy || capturing;
  return (
    <div className="flex flex-col items-center">
      <div className="w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="h-[min(52vh,420px)] w-full object-contain" style={{ transform: "scaleX(-1)" }}
          playsInline muted autoPlay onLoadedData={() => setReady(true)} aria-label="Camera preview" />
      </div>
      {cameraError && <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">{cameraError}</p>}
      {cameraError && !ready && <button type="button" onClick={()=>setAttempt(value=>value+1)} className="mt-3 min-h-12 w-full rounded-xl border font-semibold">Try camera again</button>}
      <button type="button" disabled={locked || !ready} onClick={capture}
        className="mt-6 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40">
        {locked ? "Saving…" : actionLabel}
      </button>
      <button type="button" disabled={locked} onClick={onCancel}
        className="mt-3 min-h-12 w-full rounded-2xl border border-zinc-300 text-base font-semibold dark:border-zinc-700">Cancel</button>
    </div>
  );
}
