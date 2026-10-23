'use client';

export default function ClockConnectionStatus({ offline, pending, awaitingRefresh, offlineReady, pinReady, pinTotal, reviewCount, pinCacheError, syncError, onSync }) {
  const label = offline ? 'Offline' : pending ? 'Uploading saved punches' : awaitingRefresh ? 'Refreshing clock status' : 'Connected';
  const readiness = offlineReady
    ? pinReady === pinTotal && pinTotal > 0 ? 'Ready for offline clocking' : `Offline PINs ready: ${pinReady}/${pinTotal}`
    : 'Preparing offline clocking…';
  return <div className={`relative z-30 shrink-0 border-b px-3 text-xs ${offline || pending || syncError || pinCacheError ? 'bg-amber-100 text-amber-950' : 'bg-emerald-50 text-emerald-950'}`}>
    <div className="flex min-h-6 items-center gap-2">
      <p role="status" className="min-w-0 flex-1 py-0.5">
        <span className="font-semibold">{label}</span>
        {pending > 0 ? <span> · {pending} saved in this browser</span> : <span className="hidden sm:inline"> · {readiness}</span>}
      </p>
      <details className="group shrink-0">
        <summary className="cursor-pointer list-none rounded px-1 py-1 underline underline-offset-2">Details</summary>
        <div className="absolute right-2 top-full mt-1 w-80 max-w-[calc(100vw-1rem)] space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <p>{readiness}</p>
          {pinReady < pinTotal && <p>Each employee needs one successful PIN entry while online in this browser to prepare offline access.</p>}
          {reviewCount > 0 && <p>{reviewCount} need manager review in the Hub.</p>}
          <p>Saved punches upload automatically when connected.</p>
        </div>
      </details>
      <button onClick={onSync} className="shrink-0 rounded px-1 py-1 font-semibold underline underline-offset-2">Sync now</button>
    </div>
    {pinCacheError && <p role="alert" className="pb-1">{pinCacheError}</p>}
    {syncError && <p role="alert" className="pb-1">{syncError}</p>}
  </div>;
}
