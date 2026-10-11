"use client";
import { createWorkerDetector } from './face-detect-worker-client';
import { normalizeFaceBoxes } from './face-capture';

// Share warm-up work, but never keep a failed startup or terminated worker cached.
export function createDetectorCache(factory) {
  let current;
  return () => {
    if (current && !current.detector?.closed) return current.promise;
    const entry = {};
    current = entry;
    const invalidate = () => { if (current === entry) current = null; };
    entry.promise = Promise.resolve().then(factory).then(detector => {
      entry.detector = detector;
      Promise.resolve(detector.ready).then(ready => { if (!ready) invalidate(); }, invalidate);
      return detector;
    }, error => { invalidate(); throw error; });
    return entry.promise;
  };
}
export const createFaceDetector = createDetectorCache(makeFaceDetector);
let nativeUnavailable = false;
async function makeFaceDetector() {
  if (!nativeUnavailable && typeof window !== 'undefined' && 'FaceDetector' in window) {
    try {
      const native = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      let closed = false;
      return {
        type: 'native', ready: Promise.resolve(true), get closed() { return closed; }, close() { closed = true; },
        async detect(source) {
          if (closed) return [];
          try { return normalizeFaceBoxes(await native.detect(source), source.width, source.height); }
          catch { nativeUnavailable = true; closed = true; return []; }
        },
      };
    } catch { /* Use the worker on browsers without a working native detector. */ }
  }
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    return createWorkerDetector(new Worker(new URL('./face-detect.worker.js', import.meta.url)));
  }
  // A missing detector must never block a required photo or falsely report a face.
  return { type: 'unavailable', ready: Promise.resolve(false), close() {}, async detect() { return []; } };
}

export function captureJpegBlob(video, quality = 0.72) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error("Camera is not ready yet."));
  }
  const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not capture photo."));
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture photo.")), "image/jpeg", quality);
  });
}
