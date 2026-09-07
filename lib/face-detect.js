"use client";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export async function createFaceDetector() {
  if (typeof window !== "undefined" && "FaceDetector" in window) {
    try {
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      return {
        type: "native",
        async detect(video) {
          const faces = await detector.detect(video);
          return Array.isArray(faces) && faces.length > 0;
        },
        close() {},
      };
    } catch {
      // Fall through to MediaPipe.
    }
  }

  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
  let detector;
  try {
    detector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });
  } catch {
    detector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });
  }

  return {
    type: "mediapipe",
    async detect(video) {
      const result = detector.detectForVideo(video, performance.now());
      return Boolean(result?.detections?.length);
    },
    close() {
      try {
        detector.close();
      } catch {
        /* ignore */
      }
    },
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
