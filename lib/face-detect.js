"use client";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** Intentionally low: hats and partial faces should still count as "a face is here". */
const MIN_DETECTION_CONFIDENCE = 0.3;
const MIN_SUPPRESSION_THRESHOLD = 0.2;

async function createMediaPipeDetector() {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
  const options = {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
    minSuppressionThreshold: MIN_SUPPRESSION_THRESHOLD,
  };
  try {
    return await vision.FaceDetector.createFromOptions(fileset, options);
  } catch {
    return await vision.FaceDetector.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
}

function nativeHasFace(faces) {
  return Array.isArray(faces) && faces.length > 0;
}

export async function createFaceDetector() {
  let native = null;
  if (typeof window !== "undefined" && "FaceDetector" in window) {
    try {
      native = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
    } catch {
      native = null;
    }
  }

  let mediapipe = null;
  let closed = false;
  const mediaPipeReady = createMediaPipeDetector()
    .then((detector) => {
      if (closed) {
        try {
          detector.close();
        } catch {
          /* ignore */
        }
        return;
      }
      mediapipe = detector;
    })
    .catch(() => {});

  return {
    type: native ? "native+mediapipe" : "mediapipe",
    async detect(video) {
      if (native) {
        try {
          const faces = await native.detect(video);
          if (nativeHasFace(faces)) return true;
        } catch {
          /* try MediaPipe */
        }
      }
      if (mediapipe) {
        try {
          const result = mediapipe.detectForVideo(video, performance.now());
          return Boolean(result?.detections?.length);
        } catch {
          return false;
        }
      }
      return false;
    },
    close() {
      closed = true;
      try {
        mediapipe?.close?.();
      } catch {
        /* ignore */
      }
    },
    ready: mediaPipeReady,
  };
}

export function captureJpegBlob(video, quality = 0.85) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not capture photo."));
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not capture photo."));
        else resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}
