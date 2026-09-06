"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleSubnav from "@/components/schedule/ScheduleSubnav";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import { canAccess } from "@/lib/permissions";
import {
  computeScheduledHours,
  DAY_LABELS,
  formatClock,
  formatHours,
  formatLongDate,
  formatWeekRange,
  fromTimeInput,
  nameKey,
  SCHEDULE_STORE_ID,
  timeInputValue,
  weekDates,
  weekStartSunday,
} from "@/lib/schedule";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getSupabase } from "@/lib/supabase";

const EMPTY_AVAIL = DAY_LABELS.map((_, day) => ({
  day_of_week: day,
  is_available: true,
  available_start: "",
  available_end: "",
}));

export default function MySchedule({ employee }) {
  const supabase = useMemo(() => getSupabase(), []);
  const canBuild = canAccess(employee?.role, "schedule.full");
  const [weekStart, setWeekStart] = useState(() => weekStartSunday(getStoreToday()));
  const [shifts, setShifts] = useState([]);
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState(EMPTY_AVAIL);
  const [requests, setRequests] = useState([]);
  const [toast, setToast] = useState(null);
  const [savingAvail, setSavingAvail] = useState(false);
  const [submittingTo, setSubmittingTo] = useState(false);
  const [toForm, setToForm] = useState({
    start_date: getStoreToday(),
    end_date: getStoreToday(),
    reason: "",
  });

  const fullName = `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekEnd = dates[6];

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, []);

  const loadWeek = useCallback(async () => {
    if (!employee?.employee_id) return;
    setLoading(true);
    try {
      const [{ data: weekRow, error: weekErr }, { data: shiftRows, error: shiftErr }] =
        await Promise.all([
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
      const mine = (shiftRows || []).filter((row) => {
        const target = nameKey(fullName);
        const rowName = nameKey(row.employee_name);
        if (!target || !rowName) return false;
        if (rowName === target) return true;
        const last = nameKey(employee.last_name);
        const rowLast = rowName.split(" ").pop() || "";
        return Boolean(last && (rowLast === last || rowLast.includes(last) || last.includes(rowLast)));
      });
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
  }, [employee, fullName, supabase, weekStart, weekEnd, showToast]);

  const loadProfile = useCallback(async () => {
    if (!employee?.employee_id) return;
    try {
      const [{ data: availRows, error: availErr }, { data: toRows, error: toErr }] = await Promise.all([
        supabase.from("employee_availability").select("*").eq("employee_id", employee.employee_id),
        supabase
          .from("time_off_requests")
          .select("*")
          .eq("employee_id", employee.employee_id)
          .order("start_date", { ascending: false }),
      ]);
      if (availErr) throw availErr;
      if (toErr) throw toErr;
      const next = EMPTY_AVAIL.map((day) => {
        const existing = (availRows || []).find((row) => Number(row.day_of_week) === day.day_of_week);
        if (!existing) return day;
        return {
          day_of_week: day.day_of_week,
          is_available: existing.is_available !== false,
          available_start: existing.available_start || day.available_start,
          available_end: existing.available_end || day.available_end,
          id: existing.id,
        };
      });
      setAvailability(next);
      setRequests(toRows || []);
    } catch (err) {
      showToast(err?.message || "Could not load availability.");
    }
  }, [employee, showToast, supabase]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const weekHours = shifts.reduce((sum, s) => sum + (Number(s.scheduled_hours) || computeScheduledHours(s.scheduled_start, s.scheduled_end)), 0);

  async function saveAvailability(event) {
    event.preventDefault();
    setSavingAvail(true);
    try {
      const rows = availability.map((day) => ({
        employee_id: employee.employee_id,
        employee_name: fullName,
        day_of_week: day.day_of_week,
        is_available: day.is_available,
        available_start: day.is_available ? day.available_start || null : null,
        available_end: day.is_available ? day.available_end || null : null,
      }));
      const { error } = await supabase
        .from("employee_availability")
        .upsert(rows, { onConflict: "employee_id,day_of_week" });
      if (error) throw error;
      showToast("Availability saved.", "success");
      await loadProfile();
    } catch (err) {
      showToast(err?.message || "Could not save availability.");
    } finally {
      setSavingAvail(false);
    }
  }

  async function submitTimeOff(event) {
    event.preventDefault();
    if (toForm.end_date < toForm.start_date) {
      showToast("End date must be on or after the start date.");
      return;
    }
    setSubmittingTo(true);
    try {
      const { error } = await supabase.from("time_off_requests").insert({
        employee_id: employee.employee_id,
        employee_name: fullName,
        start_date: toForm.start_date,
        end_date: toForm.end_date,
        reason: toForm.reason.trim() || null,
        status: "pending",
        store_id: SCHEDULE_STORE_ID,
      });
      if (error) throw error;
      setToForm({ start_date: getStoreToday(), end_date: getStoreToday(), reason: "" });
      showToast("Time-off request submitted.", "success");
      await loadProfile();
    } catch (err) {
      showToast(err?.message || "Could not submit time-off request.");
    } finally {
      setSubmittingTo(false);
    }
  }

  const shiftsByDate = useMemo(() => {
    const map = new Map(dates.map((d) => [d, []]));
    for (const shift of shifts) {
      map.get(shift.shift_date)?.push(shift);
    }
    return map;
  }, [dates, shifts]);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-5">
      <ScheduleSubnav current="me" canBuild={canBuild} />

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
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          Loading your schedule…
        </p>
      ) : !published ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          This week has not been published yet. You will see your shifts here after a manager publishes the schedule.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-semibold">{fullName}</p>
            <p className="text-zinc-500">{shifts.length} shifts · {formatHours(weekHours)}</p>
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
                      {dayShifts.map((shift) => (
                        <li key={shift.id} className="rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700">
                          <p className="font-semibold">
                            {formatClock(shift.scheduled_start)} – {formatClock(shift.scheduled_end)}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {[shift.role, shift.station].filter(Boolean).join(" · ") || "Shift"} ·{" "}
                            {formatHours(shift.scheduled_hours)}
                          </p>
                        </li>
                      ))}
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

      <form
        onSubmit={saveAvailability}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-bold text-[#C8102E]">Weekly availability</h2>
        <p className="mt-1 text-xs text-zinc-500">Managers use this as a warning only — it does not block scheduling.</p>
        <div className="mt-3 space-y-2">
          {availability.map((day) => (
            <div key={day.day_of_week} className="grid grid-cols-[72px_1fr] items-center gap-2 sm:grid-cols-[72px_auto_1fr_1fr]">
              <span className="text-sm font-semibold">{DAY_LABELS[day.day_of_week]}</span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={day.is_available}
                  onChange={(e) =>
                    setAvailability((current) =>
                      current.map((row) =>
                        row.day_of_week === day.day_of_week
                          ? { ...row, is_available: e.target.checked }
                          : row
                      )
                    )
                  }
                />
                Available
              </label>
              <input
                type="time"
                disabled={!day.is_available}
                value={timeInputValue(day.available_start)}
                onChange={(e) =>
                  setAvailability((current) =>
                    current.map((row) =>
                      row.day_of_week === day.day_of_week
                        ? { ...row, available_start: fromTimeInput(e.target.value) || row.available_start }
                        : row
                    )
                  )
                }
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <input
                type="time"
                disabled={!day.is_available}
                value={timeInputValue(day.available_end)}
                onChange={(e) =>
                  setAvailability((current) =>
                    current.map((row) =>
                      row.day_of_week === day.day_of_week
                        ? { ...row, available_end: fromTimeInput(e.target.value) || row.available_end }
                        : row
                    )
                  )
                }
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
          ))}
        </div>
        <button
          type="submit"
          disabled={savingAvail}
          className="mt-4 rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {savingAvail ? "Saving…" : "Save availability"}
        </button>
      </form>

      <form
        onSubmit={submitTimeOff}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-bold text-[#C8102E]">Request time off</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-600">
            Start
            <input
              type="date"
              required
              value={toForm.start_date}
              onChange={(e) => setToForm((s) => ({ ...s, start_date: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs text-zinc-600">
            End
            <input
              type="date"
              required
              value={toForm.end_date}
              onChange={(e) => setToForm((s) => ({ ...s, end_date: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>
        <label className="mt-3 block text-xs text-zinc-600">
          Reason
          <input
            type="text"
            value={toForm.reason}
            onChange={(e) => setToForm((s) => ({ ...s, reason: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <button
          type="submit"
          disabled={submittingTo}
          className="mt-4 rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submittingTo ? "Submitting…" : "Submit request"}
        </button>

        <ul className="mt-4 space-y-2">
          {requests.map((req) => (
            <li key={req.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
              <p className="font-semibold">
                {req.start_date} → {req.end_date}
              </p>
              <p className="text-xs capitalize text-zinc-500">
                {req.status}
                {req.reason ? ` · ${req.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </form>

      <ScheduleToast toast={toast} />
    </section>
  );
}
