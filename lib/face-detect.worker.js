import { normalizeFaceBoxes } from './face-capture';
import { createMediaPipeDetector } from './face-detect-runtime';

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
  detector = await createMediaPipeDetector(new OffscreenCanvas(1, 1));
  self.postMessage({ type: 'ready' });
}
prepare().catch(() => self.postMessage({ type: 'unavailable' }));
