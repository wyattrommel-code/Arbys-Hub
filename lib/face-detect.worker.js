import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { normalizeFaceBoxes } from './face-capture';

// Model initialization and synchronous inference stay off the camera/UI thread.
// Only a small temporary bitmap enters this worker; no frames are retained.
let detector;
self.onmessage = ({ data }) => {
  if (data.type !== 'detect') return;
  try {
    const result = detector?.detectForVideo(data.bitmap, data.at);
    const boxes = normalizeFaceBoxes(result?.detections, data.bitmap.width, data.bitmap.height);
    self.postMessage({ type: 'result', id: data.id, boxes });
  } catch {
    self.postMessage({ type: 'result', id: data.id, boxes: [] });
  } finally { data.bitmap.close(); }
};

async function prepare() {
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.2,
  });
  self.postMessage({ type: 'ready' });
}
prepare().catch(() => self.postMessage({ type: 'unavailable' }));
