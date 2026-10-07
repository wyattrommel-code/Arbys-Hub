// One frame at a time; capture never waits for this optional background check.
export function createWorkerDetector(worker, makeBitmap = createImageBitmap) {
  let available = false, closed = false, pending = null, sequence = 0, converting = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const startup = setTimeout(close, 15000);
  function finish(found) {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(found); pending = null;
  }
  function close() {
    if (closed) return;
    closed = true; available = false;
    clearTimeout(startup); resolveReady(false); finish(false); worker.terminate();
  }
  worker.onerror = close;
  worker.onmessageerror = close;
  worker.onmessage = ({ data }) => {
    if (closed) return;
    if (data.type === 'ready') { available = true; clearTimeout(startup); resolveReady(true); }
    else if (data.type === 'unavailable') close();
    else if (data.type === 'result' && data.id === pending?.id) finish(Boolean(data.found));
  };
  return {
    type: 'worker', ready, close,
    async detect(canvas) {
      if (!available || pending || converting) return false;
      converting = true;
      let bitmap;
      try { bitmap = await makeBitmap(canvas); }
      catch { return false; }
      finally { converting = false; }
      if (closed) { bitmap.close(); return false; }
      return new Promise(resolve => {
        const id = ++sequence;
        pending = { id, resolve, timer: setTimeout(close, 2000) };
        try { worker.postMessage({ type: 'detect', id, bitmap, at: performance.now() }, [bitmap]); }
        catch { bitmap.close(); close(); }
      });
    },
  };
}
