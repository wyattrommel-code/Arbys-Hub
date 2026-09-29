'use client';
import { useEffect, useState } from 'react';
export default function StationSettings({ clockUrl }) {
  const [station, setStation] = useState(null);
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const res = await fetch('/api/settings/clock-station', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setStation(data.station);
  }
  useEffect(() => { load().catch(err => setError(err.message)); }, []);
  async function act(action) {
    setBusy(true); setError(''); setCode(null);
    try {
      const res = await fetch('/api/settings/clock-station', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.code) setCode(data);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const active = station?.device_expires_at && new Date(station.device_expires_at) > new Date();
  return <div className="space-y-6">
    <p className="rounded-lg border p-4">{active ? 'A store iPad is authorized.' : 'No store iPad is currently authorized.'}</p>
    <ol className="list-decimal space-y-3 pl-5"><li>On the store iPad, open {clockUrl ? <a className="font-semibold text-red-700 underline" href={clockUrl} target="_blank" rel="noopener noreferrer">the dedicated time clock</a> : 'the store time clock site once it is connected'}.</li><li>Create a pairing code here and enter it on that iPad. Keep the code private; anyone who has it could authorize their browser.</li><li>A shift lead or manager then unlocks the clock for the shift. Employees use their own PINs to punch.</li></ol>
    <p>One browser can be paired at a time. Pairing a replacement disables the previous browser. Clearing iPad website data requires pairing again. Authorization expires after 180 days.</p>
    <button disabled={busy} onClick={() => act('issue')} className="rounded bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-50">Create 10-minute pairing code</button>
    {code && <div className="space-y-2 rounded-lg border bg-white p-5 text-zinc-900"><p>Enter this once on the store iPad:</p><p className="break-all font-mono text-2xl font-bold">{code.code}</p><p>Expires {new Date(code.expires).toLocaleTimeString()}. Creating another code cancels this one.</p></div>}
    <div className="border-t pt-5"><p className="mb-3">Revoke disables clock access and cancels any pending pairing code immediately.</p><button disabled={busy} onClick={() => act('revoke')} className="rounded border border-red-700 px-5 py-3 font-semibold text-red-700 disabled:opacity-50">Revoke store iPad</button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
