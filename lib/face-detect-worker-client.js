// One frame at a time, with bounded startup so unsupported worker paths can fall back.
export function createWorkerDetector(worker, makeBitmap = createImageBitmap) {
  let available = false, closed = false, pending = null, sequence = 0, converting = false, warmed = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const startup = setTimeout(close, 15000);
  function finish(boxes) {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(boxes); pending = null;
  }
  function close() {
    if (closed) return;
    closed = true; available = false;
    clearTimeout(startup); resolveReady(false); finish([]); worker.terminate();
  }
  worker.onerror = close;
  worker.onmessageerror = close;
  worker.onmessage = ({ data }) => {
    if (closed) return;
    if (data.type === 'ready') { available = true; clearTimeout(startup); resolveReady(true); }
    else if (data.type === 'unavailable') close();
    else if (data.type === 'result' && data.id === pending?.id) { warmed = true; finish(Array.isArray(data.boxes) ? data.boxes : []); }
  };
  return {
    type: 'worker', ready, close, get closed() { return closed; },
    async detect(canvas) {
      if (!available || pending || converting) return [];
      converting = true;
      let bitmap;
      try { bitmap = await makeBitmap(canvas); }
      catch { return []; }
      finally { converting = false; }
      if (closed) { bitmap.close(); return []; }
      return new Promise(resolve => {
        const id = ++sequence;
        // Initial WASM inference can be slower on iPad. Stale results are still
        // rejected by the camera, without killing a detector that is warming up.
        pending = { id, resolve, timer: setTimeout(close, warmed ? 2000 : 8000) };
        try { worker.postMessage({ type: 'detect', id, bitmap, at: performance.now() }, [bitmap]); }
        catch { bitmap.close(); close(); }
      });
    },
  };
}
