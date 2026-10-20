// Public detector files only. This worker cache never contains employee photos,
// PINs, or punches; those stay in the existing private offline queue.
export async function loadFaceAsset(url) {
  let cache;
  try { cache = await caches.open('arbys-clock-face-assets-v1'); } catch { /* Online capture can work without persistent storage. */ }
  let response;
  try { response = await cache?.match(url); } catch { /* Try the network if storage is unavailable. */ }
  if (!response) {
    response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error('Could not load automatic photos.');
    try { await cache?.put(url, response.clone()); } catch { /* Storage may be full; do not block online detection. */ }
  }
  return response;
}
