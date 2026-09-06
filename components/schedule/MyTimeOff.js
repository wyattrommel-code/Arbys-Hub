"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import { formatLongDate, SCHEDULE_STORE_ID } from "@/lib/schedule";
import { getStoreToday } from "@/lib/store-time";
import { getSupabase } from "@/lib/supabase";

export default function MyTimeOff({ employee }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [requests, setRequests] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({
    start_date: getStoreToday(),
    end_date: getStoreToday(),
    reason: "",
  });
  const fullName = `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    if (!employee?.employee_id) return;
    const { data, error } = await supabase
      .from("time_off_requests")
      .select("*")
      .eq("employee_id", employee.employee_id)
      .order("start_date", { ascending: false });
    if (error) {
      showToast(error.message || "Could not load time-off requests.");
      return;
    }
    setRequests(data || []);
  }, [employee, showToast, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (form.end_date < form.start_date) {
      showToast("End date must be on or after the start date.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("time_off_requests").insert({
        employee_id: employee.employee_id,
        employee_name: fullName,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason.trim() || null,
        status: "pending",
        store_id: SCHEDULE_STORE_ID,
      });
      if (error) throw error;
      setForm({ start_date: getStoreToday(), end_date: getStoreToday(), reason: "" });
      showToast("Time-off request submitted.", "success");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not submit time-off request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-xl font-semibold">Time off</h2>
        <p className="text-sm text-zinc-500">Requests start as pending until a manager reviews them.</p>
      </div>
      <form
        onSubmit={submit}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-600">
            Start
            <input
              type="date"
              required
              value={form.start_date}
              onChange={(e) => setForm((s) => ({ ...s, start_date: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs text-zinc-600">
            End
            <input
              type="date"
              required
              value={form.end_date}
              onChange={(e) => setForm((s) => ({ ...s, end_date: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>
        <label className="mt-3 block text-xs text-zinc-600">
          Reason
          <input
            type="text"
            value={form.reason}
            onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="mt-4 rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </form>
      <ul className="space-y-2">
        {requests.map((req) => (
          <li key={req.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-semibold">
              {formatLongDate(req.start_date)} → {formatLongDate(req.end_date)}
            </p>
            <p className="text-xs capitalize text-zinc-500">
              {req.status}
              {req.reason ? ` · ${req.reason}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <ScheduleToast toast={toast} />
    </section>
  );
}
