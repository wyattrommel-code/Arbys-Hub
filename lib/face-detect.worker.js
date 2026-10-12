import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { normalizeFaceBoxes } from './face-capture';
import { loadFaceAsset } from './face-detect-assets';

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
    self.postMessage({ type: 'unavailable' });
  } finally { data.bitmap.close(); }
};

async function prepare() {
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  const [loader, binary, model] = await Promise.all([
    loadFaceAsset(fileset.wasmLoaderPath).then(response => response.blob()),
    loadFaceAsset(fileset.wasmBinaryPath).then(response => response.blob()),
    loadFaceAsset('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite').then(response => response.arrayBuffer()),
  ]);
  const loaderUrl = URL.createObjectURL(loader), binaryUrl = URL.createObjectURL(binary);
  try {
    detector = await FaceDetector.createFromOptions({ ...fileset, wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl }, {
      baseOptions: {
        modelAssetBuffer: new Uint8Array(model),
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.65,
      minSuppressionThreshold: 0.2,
    });
  } finally { URL.revokeObjectURL(loaderUrl); URL.revokeObjectURL(binaryUrl); }
  self.postMessage({ type: 'ready' });
}
prepare().catch(() => self.postMessage({ type: 'unavailable' }));
