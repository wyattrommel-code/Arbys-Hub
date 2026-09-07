"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import ShiftMarketplace from "@/components/schedule/ShiftMarketplace";
import PunchFixes from "@/components/schedule/PunchFixes";
import {
  computeScheduledHours,
  DAY_LABELS,
  formatClock,
  formatHours,
  formatLongDate,
  formatWeekRange,
  SCHEDULE_STORE_ID,
  weekDates,
  weekStartSunday,
} from "@/lib/schedule";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getSupabase } from "@/lib/supabase";

export default function MyShifts({ employee }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [weekStart, setWeekStart] = useState(() => weekStartSunday(getStoreToday()));
  const [shifts, setShifts] = useState([]);
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [market, setMarket] = useState(null);
  const [busy, setBusy] = useState(false);

  const fullName = `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekEnd = dates[6];
  const today = getStoreToday();

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadMarket = useCallback(async () => {
    try {
      const res = await fetch("/api/shift-offers");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load shift offers.");
      setMarket(data);
    } catch (err) {
      showToast(err.message || "Could not load shift offers.");
    }
  }, [showToast]);

  const loadWeek = useCallback(async () => {
    if (!employee?.employee_id) return;
    setLoading(true);
    try {
      const [{ data: weekRow, error: weekErr }, { data: shiftRows, error: shiftErr }] = await Promise.all([
        supabase
          .from("schedule_weeks")
          .select("status")
          .eq("store_id", SCHEDULE_STORE_ID)
          .eq("week_start_date", weekStart)
          .maybeSingle(),
        supabase
          .from("schedule_shifts")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .gte("shift_date", weekStart)
          .lte("shift_date", weekEnd),
      ]);
      if (weekErr && weekErr.code !== "PGRST116") throw weekErr;
      if (shiftErr) throw shiftErr;
      const isPublished = weekRow?.status === "published";
      setPublished(isPublished);
      if (!isPublished) {
        setShifts([]);
        return;
      }
      const mine = (shiftRows || []).filter(
        (row) => employee.employee_id && String(row.employee_id) === String(employee.employee_id)
      );
      mine.sort(
        (a, b) =>
          String(a.shift_date).localeCompare(String(b.shift_date)) ||
          String(a.scheduled_start).localeCompare(String(b.scheduled_start))
      );
      setShifts(mine);
    } catch (err) {
      showToast(err?.message || "Could not load your schedule.");
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [employee, supabase, weekStart, weekEnd, showToast]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    loadMarket();
  }, [loadMarket]);

  async function createOffer(body) {
    setBusy(true);
    try {
      const res = await fetch("/api/shift-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not submit.");
      showToast(
        body.type === "drop"
          ? "Drop posted. You stay on the shift until someone picks it up and a manager approves."
          : body.type === "swap"
            ? "Swap sent for manager approval."
            : "Pickup sent for manager approval.",
        "success"
      );
      await Promise.all([loadMarket(), loadWeek()]);
    } catch (err) {
      showToast(err.message || "Could not submit.");
    } finally {
      setBusy(false);
    }
  }

  async function offerAction(id, action) {
    setBusy(true);
    try {
      const res = await fetch(`/api/shift-offers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update offer.");
      showToast(action === "claim" ? "Pickup sent for manager approval." : "Offer updated.", "success");
      await Promise.all([loadMarket(), loadWeek()]);
    } catch (err) {
      showToast(err.message || "Could not update offer.");
    } finally {
      setBusy(false);
    }
  }

  const offerByShift = useMemo(() => {
    const map = new Map();
    for (const offer of market?.my_offers || []) {
      if (offer.status === "open" || offer.status === "claimed") map.set(offer.shift_id, offer);
    }
    return map;
  }, [market]);

  const weekHours = shifts.reduce(
    (sum, s) =>
      sum + (Number(s.scheduled_hours) || computeScheduledHours(s.scheduled_start, s.scheduled_end, s.unpaid_break_minutes)),
    0
  );
  const shiftsByDate = useMemo(() => {
    const map = new Map(dates.map((d) => [d, []]));
    for (const shift of shifts) map.get(shift.shift_date)?.push(shift);
    return map;
  }, [dates, shifts]);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-5">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
        >
          ←
        </button>
        <p className="text-center text-sm font-bold text-[#C8102E]">{formatWeekRange(weekStart)}</p>
        <button
          type="button"
          onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
        >
          →
        </button>
      </div>

      {loading ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading your shifts…</p>
      ) : !published ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This week has not been published yet. You will see your shifts here after a manager publishes the schedule.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-semibold">{fullName}</p>
            <p className="text-zinc-500">
              {shifts.length} shifts · {formatHours(weekHours)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dates.map((date, idx) => {
              const dayShifts = shiftsByDate.get(date) || [];
              return (
                <article
                  key={date}
                  className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="text-sm font-bold">
                    {DAY_LABELS[idx]} · {formatLongDate(date)}
                  </p>
                  {dayShifts.length ? (
                    <ul className="mt-2 space-y-2">
                      {dayShifts.map((shift) => {
                        const offer = offerByShift.get(shift.id);
                        const upcoming = String(shift.shift_date) >= today;
                        return (
                          <li key={shift.id} className="rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700">
                            <p className="font-semibold">
                              {formatClock(shift.scheduled_start)} – {formatClock(shift.scheduled_end)}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {[shift.role, shift.station].filter(Boolean).join(" · ") || "Shift"} ·{" "}
                              {formatHours(shift.scheduled_hours)}
                            </p>
                            {offer ? (
                              <p className="mt-1 text-xs font-medium text-amber-800">
                                {offer.type_label}: {offer.status_label}
                              </p>
                            ) : null}
                            {upcoming && !offer ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => createOffer({ type: "drop", shift_id: shift.id })}
                                className="mt-2 text-xs font-semibold text-[#C8102E] disabled:opacity-50"
                              >
                                Drop shift
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-500">Off</p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      <ShiftMarketplace
        market={market}
        busy={busy}
        onAction={offerAction}
        onCreate={createOffer}
      />
      <PunchFixes />
      {market?.can_approve ? (
        <Link href="/schedule/offers" className="text-sm font-semibold text-[#C8102E]">
          Review shift offers
        </Link>
      ) : null}
      <ScheduleToast toast={toast} />
    </section>
  );
}
