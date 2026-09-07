"use client";

import { useEffect, useRef, useState } from "react";
import { captureJpegBlob, createFaceDetector } from "@/lib/face-detect";

const FACE_FALLBACK_MS = 4500;

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
        try {
          detectorRef.current = await createFaceDetector();
        } catch {
          detectorRef.current = null;
        }
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
                else if (Date.now() - startedAt >= FACE_FALLBACK_MS) setTimedOut(true);
              }
            } catch {
              if (!cancelled && Date.now() - startedAt >= FACE_FALLBACK_MS) setTimedOut(true);
            }
          } else if (!cancelled && Date.now() - startedAt >= FACE_FALLBACK_MS) {
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

  async function captureAndSend(faceDetected) {
    const video = videoRef.current;
    if (!video || capturing || busy) return;
    setCapturing(true);
    try {
      const blob = await captureJpegBlob(video);
      onCaptured(blob, faceDetected);
    } catch (err) {
      setCameraError(err?.message || "Could not capture photo.");
    } finally {
      setCapturing(false);
    }
  }

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
      onCaptured(blob, true);
    } catch (err) {
      setCameraError(err?.message || "Could not capture photo.");
    } finally {
      setCapturing(false);
    }
  }

  const locked = busy || capturing;
  const showAnyway = timedOut && !facePresent && !cameraError;

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
          {facePresent ? "Face detected" : "Look at the camera — hats are OK"}
        </p>
      </div>

      {cameraError ? (
        <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">
          {cameraError}
        </p>
      ) : showAnyway ? (
        <p className="mt-4 text-center text-sm text-zinc-500">
          Couldn&apos;t confirm a face (hats and lighting can do that). Take the photo anyway.
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
      {showAnyway ? (
        <button
          type="button"
          disabled={locked}
          onClick={() => captureAndSend(false)}
          className="mt-3 w-full min-h-16 rounded-2xl border-2 border-[#C8102E] text-xl font-bold text-[#C8102E] disabled:opacity-40"
        >
          Take photo anyway
        </button>
      ) : null}
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
