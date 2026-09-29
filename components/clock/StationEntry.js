'use client';
import { useCallback, useEffect, useState } from 'react';
import ClockKiosk from './ClockKiosk';
import KioskUnlock from './KioskUnlock';
export default function StationEntry() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/clock/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('Time clock connection unavailable. Please try again.');
      setStatus(await res.json()); setError('');
    } catch (err) { setStatus(null); setError(err.message); }
  }, []);
  useEffect(() => {
    check(); const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, [check]);
  async function pair(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/clock/device/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not pair iPad.');
      setCode(''); await check();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (status?.unlocked) return <ClockKiosk />;
  if (status?.paired) return <KioskUnlock />;
  if (!status) return <div className="m-auto space-y-4 p-6 text-center"><h1 className="text-xl font-semibold">Store time clock</h1><p role="status">{error || 'Connecting…'}</p>{error && <button onClick={check} className="rounded bg-red-700 px-5 py-3 text-white">Try again</button>}</div>;
  return <form onSubmit={pair} className="m-auto w-full max-w-md space-y-5 rounded-xl border bg-white p-6 text-zinc-900">
    <h1 className="text-2xl font-semibold">Pair the store iPad</h1>
    <p>This clock is for the store iPad only. Ask your GM to enter a pairing code from Hub Settings → Store iPad.</p>
    <label className="block font-medium">Pairing code<input autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={30} value={code} onChange={e => setCode(e.target.value)} className="mt-2 w-full rounded border p-3 font-mono" /></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button disabled={busy || code.replace(/[\s-]/g, '').length !== 20} className="w-full rounded bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Pairing…' : 'Authorize this iPad'}</button>
  </form>;
}
