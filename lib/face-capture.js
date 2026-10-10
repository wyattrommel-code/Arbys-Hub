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

// Claim before encoding/uploading. Failed saves never start an automatic retry
// loop; the employee can explicitly retry with the photo button.
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
