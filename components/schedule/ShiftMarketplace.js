"use client";

import { useMemo, useState } from "react";

function statusClass(status) {
  if (status === "approved") return "bg-green-100 text-green-800";
  if (status === "claimed") return "bg-amber-100 text-amber-900";
  if (status === "denied") return "bg-red-100 text-red-800";
  if (status === "cancelled") return "bg-zinc-100 text-zinc-600";
  return "bg-blue-100 text-blue-800";
}

function ShiftLine({ shift }) {
  if (!shift) return <p className="text-xs text-zinc-500">Shift unavailable</p>;
  return (
    <p className="text-sm">
      <span className="font-semibold">
        {shift.date_label} · {shift.start_label} – {shift.end_label}
      </span>
      <span className="block text-xs text-zinc-500">
        {[shift.role, shift.station, shift.hours_label, shift.employee_name].filter(Boolean).join(" · ")}
      </span>
    </p>
  );
}

export default function ShiftMarketplace({ market, busy, onAction, onCreate }) {
  const [swapFrom, setSwapFrom] = useState("");
  const [swapTo, setSwapTo] = useState("");
  const [note, setNote] = useState("");

  const targetsByDate = useMemo(() => {
    const map = new Map();
    for (const shift of market?.swap_targets || []) {
      if (!map.has(shift.date)) map.set(shift.date, []);
      map.get(shift.date).push(shift);
    }
    return [...map.entries()];
  }, [market]);

  async function submitSwap(event) {
    event.preventDefault();
    if (!swapFrom || !swapTo) return;
    await onCreate({ type: "swap", shift_id: swapFrom, swap_target_shift_id: swapTo, note });
    setNote("");
    setSwapTo("");
  }

  const pickupDrops = market?.pickup_drops || [];
  const pickupOpen = market?.pickup_open || [];
  const myOffers = market?.my_offers || [];
  const myShifts = market?.my_shifts || [];

  if (!market) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading coverage board…</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Pick up a shift</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Open drops and unassigned shifts. Pickup waits for GM or assistant manager approval before the schedule
          changes.
        </p>
        {!pickupDrops.length && !pickupOpen.length ? (
          <p className="mt-3 text-sm text-zinc-500">Nothing open to pick up right now.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pickupDrops.map((offer) => (
              <li
                key={offer.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <div>
                  <ShiftLine shift={offer.shift} />
                  <p className="text-xs text-zinc-500">Dropped by {offer.offered_by_name}</p>
                  {offer.overlap_warning ? (
                    <p className="text-xs font-medium text-amber-800">{offer.overlap_warning}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(offer.id, "claim")}
                  className="rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Pick up
                </button>
              </li>
            ))}
            {pickupOpen.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700"
              >
                <div>
                  <ShiftLine shift={shift} />
                  <p className="text-xs font-medium text-zinc-600">Unassigned · OPEN</p>
                  {shift.overlap_warning ? (
                    <p className="text-xs font-medium text-amber-800">{shift.overlap_warning}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onCreate({ type: "pickup_open", shift_id: shift.id })}
                  className="rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Pick up
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Swap a shift</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Trade one of yours for someone else's. It goes to a manager for approval once both shifts are picked.
        </p>
        {!myShifts.length ? (
          <p className="mt-3 text-sm text-zinc-500">You have no upcoming published shifts to swap.</p>
        ) : (
          <form onSubmit={submitSwap} className="mt-3 grid gap-3">
            <label className="text-xs font-medium text-zinc-600">
              Your shift
              <select
                value={swapFrom}
                onChange={(e) => setSwapFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Select…</option>
                {myShifts.map((shift) => (
                  <option key={shift.id} value={shift.id} disabled={Boolean(shift.active_offer_status)}>
                    {shift.date_label} {shift.start_label}–{shift.end_label}
                    {shift.active_offer_status ? " (offer pending)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Shift you want
              <select
                value={swapTo}
                onChange={(e) => setSwapTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Select…</option>
                {targetsByDate.map(([date, shifts]) => (
                  <optgroup key={date} label={shifts[0]?.date_label || date}>
                    {shifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.employee_name} · {shift.start_label}–{shift.end_label}
                        {[shift.role, shift.station].filter(Boolean).length
                          ? ` · ${[shift.role, shift.station].filter(Boolean).join(" · ")}`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !swapFrom || !swapTo}
              className="justify-self-start rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Send swap for approval
            </button>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Your offers</h3>
        {!myOffers.length ? (
          <p className="mt-3 text-sm text-zinc-500">No drop or swap requests yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {myOffers.map((offer) => (
              <li
                key={offer.id}
                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(offer.status)}`}>
                    {offer.type_label} · {offer.status_label}
                  </span>
                  {offer.status === "open" || offer.status === "claimed" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAction(offer.id, "cancel")}
                      className="text-xs font-semibold text-zinc-600"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
                <div className="mt-1">
                  <ShiftLine shift={offer.shift} />
                  {offer.target_shift ? (
                    <p className="text-xs text-zinc-500">
                      For {offer.target_shift.employee_name}'s {offer.target_shift.date_label}{" "}
                      {offer.target_shift.start_label}–{offer.target_shift.end_label}
                    </p>
                  ) : null}
                  {offer.claimed_by_name && offer.type === "drop" ? (
                    <p className="text-xs text-zinc-500">Picked up by {offer.claimed_by_name}</p>
                  ) : null}
                  {offer.approved_by ? (
                    <p className="text-xs text-zinc-500">Reviewed by {offer.approved_by}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { statusClass, ShiftLine };
