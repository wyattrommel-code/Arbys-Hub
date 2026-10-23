"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquireClockCamera } from '@/lib/clock-camera';
import { captureJpegBlob, createFaceDetector } from "@/lib/face-detect";
import { createFaceCaptureGate, createStableFaceTracker, faceBracketPath, isFreshFace } from '@/lib/face-capture';

export default function FaceCapture({ actionLabel = "Clock in", onConfirm, onCancel, busy = false }) {
  const videoRef = useRef(null);
  const faceRef = useRef({ boxes: [], at: 0 });
  const captureRef = useRef(null);
  const sessionRef = useRef(null);
  const submittingRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [faces, setFaces] = useState([]);
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 });

  const capture = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || photo || !isFreshFace(faceRef.current, performance.now())) return;
    if (!session.gate.start({ automatic: true, ready, busy, visible: document.visibilityState === 'visible' })) return;
    setCapturing(true); setCameraError("");
    try {
      const blob = await captureJpegBlob(videoRef.current);
      if (session !== sessionRef.current || document.visibilityState !== 'visible') return;
      if (!blob?.size) throw new Error('Could not capture photo. Try camera again.');
      // Preparing a photo never saves a punch. The action button does that.
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      if (session === sessionRef.current) setCameraError(err?.message || "Could not capture photo. Try camera again.");
    } finally {
      session.gate.finish();
      if (session === sessionRef.current) setCapturing(false);
    }
  }, [busy, ready, photo]);

  useEffect(() => { captureRef.current = capture; }, [capture]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  useEffect(() => {
    if (photo || document.visibilityState !== 'visible') return;
    let cancelled = false, timer, detector, retries = 1;
    const session = { gate: createFaceCaptureGate() };
    const stableFace = createStableFaceTracker();
    sessionRef.current = session;
    setReady(false); setCapturing(false); setCameraError(''); setFaces([]); faceRef.current = { boxes: [], at: 0 };
    const camera = acquireClockCamera();
    const detectorPromise = createFaceDetector().catch(() => null);
    async function loadDetector(promise) {
      detector = await promise;
      const available = detector && !detector.closed && await detector.ready.catch(() => false);
      if (cancelled) return false;
      if (available) return true;
      if (detector?.type !== 'unavailable' && retries-- > 0) return loadDetector(createFaceDetector().catch(() => null));
      setCameraError('Automatic photos are unavailable. Try camera again.');
      return false;
    }
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
        if (!await loadDetector(detectorPromise)) return;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error('Could not prepare automatic photos. Try camera again.');
        async function tick() {
          if (cancelled || document.visibilityState !== 'visible') return;
          if (detector.closed) {
            faceRef.current = { boxes: [], at: 0 }; setFaces([]); stableFace.reset();
            if (retries-- <= 0) { setCameraError('Automatic photos stopped. Try camera again.'); return; }
            if (!await loadDetector(createFaceDetector().catch(() => null))) return;
          }
          if (!session.gate.inFlight && video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const at = performance.now();
            let boxes = [];
            try { boxes = await detector.detect(canvas); }
            catch { detector.close(); }
            if (cancelled || document.visibilityState !== 'visible') return;
            const face = { boxes, at };
            faceRef.current = isFreshFace(face, performance.now()) ? face : { boxes: [], at: 0 };
            setFaces(faceRef.current.boxes);
            if (stableFace.update(faceRef.current, performance.now())) void captureRef.current?.();
          }
          if (!cancelled) timer = window.setTimeout(tick, 150);
        }
        void tick();
      } catch (err) {
        if (!cancelled) setCameraError(err?.name === 'NotAllowedError'
          ? 'Camera access is blocked. Open this browser’s site permissions, allow Camera, then try again.'
          : err?.message || 'Camera unavailable. Try again.');
      }
    }
    void start();
    return () => {
      cancelled = true;
      sessionRef.current = null;
      window.clearTimeout(timer);
      camera.release();
    };
  }, [attempt, photo]);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') setAttempt(value => value + 1);
      else {
        sessionRef.current = null;
        faceRef.current = { boxes: [], at: 0 };
        setFaces([]); setReady(false);
        if (!submittingRef.current) setPhoto(null);
      }
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);

  async function confirm() {
    if (!photo || busy || capturing || submittingRef.current || submitted || document.visibilityState !== 'visible') return;
    submittingRef.current = true; setSubmitting(true); setCameraError('');
    try {
      const saved = await onConfirm(photo.blob, true);
      if (saved !== false) setSubmitted(true);
    } catch (err) {
      setCameraError(err?.message || 'Could not save punch. Try again.');
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  const locked = busy || capturing || submitting || submitted;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full overflow-hidden rounded-lg bg-black">
        {photo ? <Image src={photo.url} alt="Captured photo" width={frameSize.width} height={frameSize.height} unoptimized loading="eager" className="h-[min(42dvh,300px)] w-full object-contain" style={{ transform: 'scaleX(-1)' }} />
          : <video ref={videoRef} className="h-[min(42dvh,300px)] w-full object-contain" style={{ transform: "scaleX(-1)" }}
          playsInline muted autoPlay onLoadedData={() => setReady(true)}
          onResize={event => setFrameSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
          aria-label="Camera preview" />}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={'0 0 ' + frameSize.width + ' ' + frameSize.height} preserveAspectRatio="xMidYMid meet"
          style={{ transform: "scaleX(-1)", filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 65%))" }}>
          {faces.map((face, index) => <path key={index} d={faceBracketPath(face, frameSize.width, frameSize.height)}
            fill="none" stroke="#86efac" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
      </div>
      {cameraError && <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">{cameraError}</p>}
      {cameraError && !photo && <button type="button" disabled={locked} onClick={() => setAttempt(value => value + 1)} className="mt-3 min-h-11 w-full rounded-xl border font-semibold">Try camera again</button>}
      <button type="button" disabled={locked || !photo} onClick={confirm}
        className="mt-3 min-h-11 w-full rounded-lg bg-[#C8102E] text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400">
        {actionLabel}
      </button>
      <div className="mt-2 flex w-full gap-2">
      {photo && <button type="button" disabled={locked} onClick={() => setPhoto(null)}
        className="min-h-11 flex-1 rounded-lg border border-zinc-300 text-base font-semibold dark:border-zinc-700">Retake photo</button>}
      <button type="button" disabled={locked} onClick={onCancel}
        className="min-h-11 flex-1 rounded-lg border border-zinc-300 text-base font-semibold dark:border-zinc-700">Cancel</button>
      </div>
    </div>
  );
}
