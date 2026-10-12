// Keep preview coordinates independent of inference resolution and iPad orientation.
export function normalizeFaceBoxes(detections, width, height) {
  if (!(width > 0 && height > 0)) return [];
  return (detections || []).flatMap(({ boundingBox: box }) => {
    if (!box) return [];
    const x = box.originX ?? box.x, y = box.originY ?? box.y;
    if (![x, y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return [];
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(width, x + box.width), bottom = Math.min(height, y + box.height);
    if (right <= left || bottom <= top) return [];
    return [{ x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height }];
  }).slice(0, 5);
}

export function faceBracketPath(box, width, height) {
  const x = box.x * width, y = box.y * height;
  const right = x + box.width * width, bottom = y + box.height * height;
  const corner = Math.min(24, (right - x) * 0.18, (bottom - y) * 0.18);
  return `M${x},${y + corner}V${y}H${x + corner} M${right - corner},${y}H${right}V${y + corner} M${right},${bottom - corner}V${bottom}H${right - corner} M${x + corner},${bottom}H${x}V${bottom - corner}`;
}

export function isFreshFace(face, now) {
  return Boolean(face.boxes.length && now >= face.at && now - face.at < 1000);
}

// A single detection can be a fleeting/partial face. Require a fully framed face
// to remain in the same place across several fresh frames before taking a photo.
export function createStableFaceTracker() {
  let tracked = null;
  return {
    reset() { tracked = null; },
    update(face, now) {
      const box = isFreshFace(face, now) ? face.boxes
        .filter(box => box.width >= 0.12 && box.height >= 0.12 && box.x >= 0.015 && box.y >= 0.015
          && box.x + box.width <= 0.985 && box.y + box.height <= 0.985)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0] : null;
      if (!box) { tracked = null; return false; }
      const previous = tracked?.box;
      const overlap = previous ? Math.max(0, Math.min(box.x + box.width, previous.x + previous.width) - Math.max(box.x, previous.x))
        * Math.max(0, Math.min(box.y + box.height, previous.y + previous.height) - Math.max(box.y, previous.y)) : 0;
      const union = previous ? box.width * box.height + previous.width * previous.height - overlap : 1;
      if (!tracked || face.at <= tracked.last || face.at - tracked.last >= 1000 || overlap / union < 0.65) {
        tracked = { box, first: face.at, last: face.at, frames: 1 };
        return false;
      }
      tracked.last = face.at;
      tracked.frames++;
      return tracked.frames >= 3 && face.at - tracked.first >= 350;
    },
  };
}

// Claim before encoding so consecutive detections cannot capture twice.
// A failed automatic photo waits for an explicit new camera attempt.
export function createFaceCaptureGate() {
  let inFlight = false, attempted = false;
  return {
    get inFlight() { return inFlight; },
    start({ automatic, ready, busy, visible }) {
      if (!ready || busy || !visible || inFlight || (automatic && attempted)) return false;
      inFlight = true;
      attempted = true;
      return true;
    },
    finish() { inFlight = false; },
  };
}
