"use client";

import { useCallback, useEffect, useState } from "react";
import { ShiftLine, statusClass } from "@/components/schedule/ShiftMarketplace";

export default function ShiftOffersQueue() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/shift-offers?view=queue");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load shift offers.");
      setPayload(data);
    } catch (err) {
      setError(err.message || "Could not load shift offers.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id, action) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/shift-offers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update offer.");
      setNote("");
      await load();
    } catch (err) {
      setError(err.message || "Could not update offer.");
    } finally {
      setBusy(false);
    }
  }

  const canApprove = Boolean(payload?.can_approve);
  const pending = payload?.pending || [];
  const openDrops = payload?.open_drops || [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Shift offers</h2>
        <p className="text-sm text-zinc-500">
          Approve a pickup or swap to reassign the published schedule so attendance treats it as scheduled coverage.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {!canApprove && payload ? (
        <p className="text-xs text-zinc-500">Shift leads can review the queue. GM or assistant manager can approve.</p>
      ) : null}

      {canApprove ? (
        <label className="text-xs font-medium text-zinc-600">
          Note (optional, saved on approve or deny)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
      ) : null}

      {loading ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading offers…</p>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-sm font-semibold">Needs approval</h3>
            {!pending.length ? (
              <p className="mt-3 text-sm text-zinc-500">No claimed drops or swaps waiting.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pending.map((offer) => (
                  <li key={offer.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(offer.status)}`}>
                        {offer.type_label} · {offer.status_label}
                      </span>
                      <span className="text-xs text-zinc-500">{offer.offered_by_name}</span>
                      {offer.claimed_by_name ? (
                        <span className="text-xs text-zinc-500">→ {offer.claimed_by_name}</span>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <ShiftLine shift={offer.shift} />
                      {offer.target_shift ? (
                        <p className="mt-1 text-xs text-zinc-500">
                          Swap for {offer.target_shift.employee_name} · {offer.target_shift.date_label}{" "}
                          {offer.target_shift.start_label}–{offer.target_shift.end_label}
                        </p>
                      ) : null}
                    </div>
                    {(offer.overlap_warnings || []).map((warn) => (
                      <p key={warn} className="mt-1 text-xs font-medium text-amber-800">
                        {warn}
                      </p>
                    ))}
                    {offer.note ? <p className="mt-1 text-xs text-zinc-500">{offer.note}</p> : null}
                    {canApprove ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => review(offer.id, "approve")}
                          className="rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => review(offer.id, "deny")}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-sm font-semibold">Open drops (no pickup yet)</h3>
            <p className="mt-1 text-xs text-zinc-500">
              A drop alone does not uncover the shift. Approve as open only if you want it Unassigned.
            </p>
            {!openDrops.length ? (
              <p className="mt-3 text-sm text-zinc-500">No unclaimed drops.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {openDrops.map((offer) => (
                  <li key={offer.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                    <p className="text-xs text-zinc-500">{offer.offered_by_name} wants to drop</p>
                    <div className="mt-1">
                      <ShiftLine shift={offer.shift} />
                    </div>
                    {canApprove ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => review(offer.id, "approve_open")}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 disabled:opacity-50"
                        >
                          Approve as Unassigned
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => review(offer.id, "deny")}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
