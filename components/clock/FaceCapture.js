"use client";

import { useEffect, useRef, useState } from "react";
import { captureJpegBlob, createFaceDetector } from "@/lib/face-detect";

const FACE_TIMEOUT_MS = 10000;

export default function FaceCapture({
  actionLabel = "Capture & continue",
  onCaptured,
  onCancel,
  busy = false,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(0);
  const [cameraError, setCameraError] = useState("");
  const [facePresent, setFacePresent] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        detectorRef.current = await createFaceDetector();
        if (cancelled) return;

        const tick = async () => {
          if (cancelled) return;
          const videoEl = videoRef.current;
          const detector = detectorRef.current;
          if (videoEl && detector && videoEl.readyState >= 2) {
            try {
              const found = await detector.detect(videoEl);
              if (!cancelled) {
                setFacePresent(Boolean(found));
                if (found) setTimedOut(false);
                else if (Date.now() - startedAt >= FACE_TIMEOUT_MS) setTimedOut(true);
              }
            } catch {
              if (!cancelled && Date.now() - startedAt >= FACE_TIMEOUT_MS) setTimedOut(true);
            }
          } else if (!cancelled && Date.now() - startedAt >= FACE_TIMEOUT_MS) {
            setTimedOut(true);
          }
          rafRef.current = window.setTimeout(tick, 200);
        };
        tick();
      } catch (err) {
        if (!cancelled) {
          setCameraError(err?.message || "Camera is blocked. Allow camera access and try again.");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      window.clearTimeout(rafRef.current);
      detectorRef.current?.close?.();
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function handleCapture() {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || capturing || busy) return;
    setCapturing(true);
    try {
      let present = facePresent;
      if (detector) {
        present = await detector.detect(video);
        setFacePresent(present);
      }
      if (!present) {
        setTimedOut(true);
        return;
      }
      const blob = await captureJpegBlob(video);
      onCaptured(blob);
    } catch (err) {
      setCameraError(err?.message || "Could not capture photo.");
    } finally {
      setCapturing(false);
    }
  }

  const locked = busy || capturing;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          className="h-[min(52vh,420px)] w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          playsInline
          muted
          autoPlay
        />
        <div
          className={`pointer-events-none absolute inset-x-8 top-8 bottom-8 rounded-[40%] border-4 ${
            facePresent ? "border-emerald-400" : "border-white/50"
          }`}
        />
        <p
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-sm font-semibold ${
            facePresent ? "bg-emerald-500 text-white" : "bg-black/70 text-white"
          }`}
        >
          {facePresent ? "Face detected" : "Center your face"}
        </p>
      </div>

      {cameraError ? (
        <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">
          {cameraError}
        </p>
      ) : timedOut && !facePresent ? (
        <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">
          No face detected, please center your face
        </p>
      ) : (
        <p className="mt-4 text-center text-sm text-zinc-500">
          Capture is enabled once a face is in the frame.
        </p>
      )}

      <button
        type="button"
        disabled={locked || !facePresent || Boolean(cameraError)}
        onClick={handleCapture}
        className="mt-6 w-full min-h-16 rounded-2xl bg-[#C8102E] text-xl font-bold text-white shadow-sm disabled:opacity-40"
      >
        {locked ? "Working…" : actionLabel}
      </button>
      <button
        type="button"
        disabled={locked}
        onClick={onCancel}
        className="mt-3 min-h-12 w-full rounded-2xl border border-zinc-300 text-base font-semibold dark:border-zinc-700"
      >
        Cancel
      </button>
    </div>
  );
}
