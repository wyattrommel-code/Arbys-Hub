"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acquireClockCamera } from '@/lib/clock-camera';
import { captureJpegBlob, createFaceDetector } from "@/lib/face-detect";
import { createFaceCaptureGate, faceBracketPath, isFreshFace } from '@/lib/face-capture';

export default function FaceCapture({ actionLabel = "Take photo", onCaptured, onCancel, busy = false }) {
  const videoRef = useRef(null);
  const faceRef = useRef({ boxes: [], at: 0 });
  const captureRef = useRef(null);
  const generationRef = useRef(null);
  const [captureGate] = useState(createFaceCaptureGate);
  const [cameraError, setCameraError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [faces, setFaces] = useState([]);
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 });

  const capture = useCallback(async (automatic = false) => {
    const faceDetected = isFreshFace(faceRef.current, performance.now());
    if (automatic && !faceDetected) return;
    if (!captureGate.start({ automatic, ready, busy, visible: document.visibilityState === 'visible' })) return;
    const generation = generationRef.current;
    setCapturing(true); setCameraError("");
    try {
      const blob = await captureJpegBlob(videoRef.current);
      if (generation !== generationRef.current || document.visibilityState !== 'visible') return;
      await onCaptured(blob, faceDetected);
    } catch (err) {
      if (generation === generationRef.current) setCameraError(err?.message || "Could not capture photo. Try again.");
    } finally { captureGate.finish(); setCapturing(false); }
  }, [busy, ready, onCaptured, captureGate]);

  useEffect(() => { captureRef.current = capture; }, [capture]);

  useEffect(() => {
    let cancelled = false, timer;
    generationRef.current = {};
    setReady(false); setCameraError(''); setFaces([]); faceRef.current = { boxes: [], at: 0 };
    const camera = acquireClockCamera();
    const detectorPromise = createFaceDetector().catch(() => null);
    async function start() {
      try {
        const stream = await camera.ready;
        if (cancelled) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setReady(video.readyState >= 2 && video.videoWidth > 0);
        setFrameSize({ width: video.videoWidth || 640, height: video.videoHeight || 480 });
        const detector = await detectorPromise;
        // The camera and manual button are already ready while the worker loads.
        if (!detector || !await detector.ready || cancelled) return;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        async function tick() {
          if (cancelled || document.visibilityState !== 'visible') return;
          if (!captureGate.inFlight && video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const at = performance.now();
            let boxes = [];
            try { boxes = await detector.detect(canvas); }
            catch { /* Manual photo capture remains available without detection. */ }
            if (cancelled || document.visibilityState !== 'visible') return;
            const face = { boxes, at };
            faceRef.current = isFreshFace(face, performance.now()) ? face : { boxes: [], at: 0 };
            setFaces(faceRef.current.boxes);
            if (faceRef.current.boxes.length) void captureRef.current?.(true);
          }
          if (!cancelled) timer = window.setTimeout(tick, 200);
        }
        void tick();
      } catch (err) {
        if (!cancelled) setCameraError(err?.name === 'NotAllowedError'
          ? 'Camera access is blocked. In Safari, open the page menu → Website Settings → Camera → Allow, then try again.'
          : err?.message || 'Camera unavailable. Try again.');
      }
    }
    void start();
    return () => {
      cancelled = true;
      generationRef.current = null;
      window.clearTimeout(timer);
      camera.release();
    };
  }, [attempt, captureGate]);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') setAttempt(value => value + 1);
      else {
        generationRef.current = null;
        faceRef.current = { boxes: [], at: 0 };
        setFaces([]); setReady(false);
      }
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);

  const locked = busy || capturing;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="h-[min(52vh,420px)] w-full object-contain" style={{ transform: "scaleX(-1)" }}
          playsInline muted autoPlay onLoadedData={() => setReady(true)}
          onResize={event => setFrameSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
          aria-label="Camera preview" />
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={'0 0 ' + frameSize.width + ' ' + frameSize.height} preserveAspectRatio="xMidYMid meet"
          style={{ transform: "scaleX(-1)", filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 65%))" }}>
          {faces.map((face, index) => <path key={index} d={faceBracketPath(face, frameSize.width, frameSize.height)}
            fill="none" stroke="#86efac" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
      </div>
      {cameraError && <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">{cameraError}</p>}
      {cameraError && !ready && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 min-h-12 w-full rounded-xl border font-semibold">Try camera again</button>}
      <button type="button" disabled={locked || !ready} onClick={() => capture(false)}
        className="mt-6 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40">
        {locked ? "Saving…" : actionLabel}
      </button>
      <button type="button" disabled={locked} onClick={onCancel}
        className="mt-3 min-h-12 w-full rounded-2xl border border-zinc-300 text-base font-semibold dark:border-zinc-700">Cancel</button>
    </div>
  );
}
