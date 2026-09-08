"use client";
import { useState } from "react";
export default function KioskUnlock() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function unlock(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await fetch("/api/clock/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Could not unlock");
      window.location.reload();
    } catch (err) { setError(err.message); setPin(""); } finally { setBusy(false); }
  }
  return <form onSubmit={unlock} className="m-auto w-full max-w-sm space-y-4 rounded-xl border p-6">
    <h1 className="text-xl font-semibold">Unlock time clock</h1>
    <p>A shift lead or manager can unlock this device for the shift.</p>
    <label className="block">Manager PIN<input aria-label="Manager PIN" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="mt-2 w-full rounded border p-3" /></label>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || pin.length !== 4} className="rounded bg-red-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Unlocking…" : "Unlock"}</button>
  </form>;
}
