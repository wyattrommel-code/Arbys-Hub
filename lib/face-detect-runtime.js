import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { loadFaceAsset } from './face-detect-assets';

// Always supply the drawing surface. MediaPipe's browser-name check can choose
// document.createElement inside an iPad worker, where document does not exist.
export async function createMediaPipeDetector(canvas) {
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  const [loader, binary, model] = await Promise.all([
    loadFaceAsset(fileset.wasmLoaderPath).then(response => response.blob()),
    loadFaceAsset(fileset.wasmBinaryPath).then(response => response.blob()),
    loadFaceAsset('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite').then(response => response.arrayBuffer()),
  ]);
  const loaderUrl = URL.createObjectURL(loader), binaryUrl = URL.createObjectURL(binary);
  try {
    return await FaceDetector.createFromOptions({ ...fileset, wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl }, {
      canvas,
      baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: 'CPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.65,
      minSuppressionThreshold: 0.2,
    });
  } finally { URL.revokeObjectURL(loaderUrl); URL.revokeObjectURL(binaryUrl); }
}
