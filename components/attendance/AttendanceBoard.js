"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { employeeFullName, fetchEmployees } from "@/lib/employees";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getSupabase } from "@/lib/supabase";

const WINDOWS = [30, 60, 90];
const MANUAL_TYPES = [
  { value: "call_out", label: "Call-out" },
  { value: "no_show", label: "No show" },
  { value: "late", label: "Late" },
  { value: "left_early", label: "Left early" },
  { value: "unscheduled", label: "Unscheduled" },
  { value: "clock_in_early", label: "Clocked in early" },
];

function typeBadge(type) {
  if (type === "late" || type === "no_show") return "bg-red-100 text-red-800";
  if (type === "call_out") return "bg-amber-100 text-amber-900";
  if (type === "unscheduled") return "bg-purple-100 text-purple-800";
  if (type === "left_early" || type === "early_out") return "bg-orange-100 text-orange-900";
  if (type === "clock_in_early") return "bg-blue-100 text-blue-800";
  return "bg-zinc-100 text-zinc-700";
}

function minutesLabel(event) {
  const n = Number(event.minutes_delta);
  if (!Number.isFinite(n) || n === 0) return "—";
  if (event.event_type === "late") return `${n} min late`;
  if (event.event_type === "clock_in_early" || event.event_type === "left_early" || event.event_type === "early_out") {
    return `${n} min early`;
  }
  return `${n} min`;
}

export default function AttendanceBoard() {
  const today = getStoreToday();
  const [from, setFrom] = useState(() => addDaysISO(today, -13));
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [events, setEvents] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [windowDays, setWindowDays] = useState(30);
  const [rollup, setRollup] = useState([]);
  const [saving, setSaving] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [manual, setManual] = useState({
    employee_id: "",
    event_date: today,
    event_type: "call_out",
    note: "",
  });

  useEffect(() => {
    fetchEmployees(getSupabase(), { select: "id, first_name, last_name, is_active" })
      .then((rows) => setEmployees(rows || []))
      .catch(() => setEmployees([]));
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (employeeId) params.set("employee_id", employeeId);
      const res = await fetch(`/api/attendance/events?${params}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load attendance.");
      setEvents(data.events || []);
    } catch (err) {
      setError(err.message || "Could not load attendance.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, employeeId]);

  const loadRollup = useCallback(async () => {
    const start = addDaysISO(getStoreToday(), -(windowDays - 1));
    const end = getStoreToday();
    try {
      const res = await fetch(`/api/attendance/events?from=${start}&to=${end}`);
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      const map = new Map();
      for (const event of data.events || []) {
        const key = event.employee_id || event.employee_name;
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: event.employee_name || "Unknown",
            late: 0,
            no_show: 0,
            call_out: 0,
            unscheduled: 0,
          });
        }
        const row = map.get(key);
        if (event.event_type === "late") row.late += 1;
        if (event.event_type === "no_show") row.no_show += 1;
        if (event.event_type === "call_out") row.call_out += 1;
        if (event.event_type === "unscheduled") row.unscheduled += 1;
      }
      setRollup(
        [...map.values()].sort(
          (a, b) => b.late + b.no_show + b.call_out + b.unscheduled - (a.late + a.no_show + a.call_out + a.unscheduled)
        )
      );
    } catch {
      setRollup([]);
    }
  }, [windowDays]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadRollup();
  }, [loadRollup]);

  async function rescan() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/attendance/rescan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Re-scan failed.");
      await Promise.all([loadEvents(), loadRollup()]);
    } catch (err) {
      setError(err.message || "Re-scan failed.");
    } finally {
      setSaving(false);
    }
  }

  async function addManual(event) {
    event.preventDefault();
    if (!manual.employee_id || !manual.event_date) return;
    setSaving(true);
    setError("");
    try {
      const emp = employees.find((row) => row.id === manual.employee_id);
      const res = await fetch("/api/attendance/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...manual,
          employee_name: emp ? employeeFullName(emp) : "",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not add event.");
      setManual((s) => ({ ...s, note: "" }));
      await Promise.all([loadEvents(), loadRollup()]);
    } catch (err) {
      setError(err.message || "Could not add event.");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote(id) {
    const note = noteDrafts[id];
    if (note == null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/attendance/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save note.");
      setNoteDrafts((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      await loadEvents();
    } catch (err) {
      setError(err.message || "Could not save note.");
    } finally {
      setSaving(false);
    }
  }

  const chronic = useMemo(
    () => rollup.filter((row) => row.late >= 3 || row.no_show >= 2 || row.unscheduled >= 2),
    [rollup]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Attendance flags</h2>
          <p className="text-sm text-zinc-500">Late, no-show, call-out, and unscheduled work vs the published schedule.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/schedule/timecards"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
          >
            Timecards
          </a>
          <button
            type="button"
            onClick={rescan}
            disabled={saving}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Working…" : "Re-scan range"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-semibold">Patterns</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setWindowDays(days)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                windowDays === days ? "bg-[#C8102E] text-white" : "border border-zinc-300 text-zinc-700"
              }`}
            >
              Last {days} days
            </button>
          ))}
        </div>
        {chronic.length ? (
          <p className="mt-3 text-sm text-red-700">
            Watch: {chronic.map((row) => `${row.name} (${row.late} late / ${row.no_show} no-show)`).join(" · ")}
          </p>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">No chronic patterns in this window.</p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[640px] w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-800">
              <tr>
                <th className="px-2 py-2">Employee</th>
                <th className="px-2 py-2">Late</th>
                <th className="px-2 py-2">No-show</th>
                <th className="px-2 py-2">Call-out</th>
                <th className="px-2 py-2">Unscheduled</th>
              </tr>
            </thead>
            <tbody>
              {rollup.slice(0, 12).map((row) => (
                <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-2 font-medium">{row.name}</td>
                  <td className="px-2 py-2">{row.late}</td>
                  <td className="px-2 py-2">{row.no_show}</td>
                  <td className="px-2 py-2">{row.call_out}</td>
                  <td className="px-2 py-2">{row.unscheduled}</td>
                </tr>
              ))}
              {rollup.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={5}>
                    No flags in the last {windowDays} days.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <form
        onSubmit={addManual}
        className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-xs font-medium text-zinc-600">
          Employee
          <select
            required
            value={manual.employee_id}
            onChange={(e) => setManual((s) => ({ ...s, employee_id: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Select…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {employeeFullName(emp)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Date
          <input
            type="date"
            required
            value={manual.event_date}
            onChange={(e) => setManual((s) => ({ ...s, event_date: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Event
          <select
            value={manual.event_type}
            onChange={(e) => setManual((s) => ({ ...s, event_type: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {MANUAL_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-600 lg:col-span-1">
          Note
          <input
            value={manual.note}
            onChange={(e) => setManual((s) => ({ ...s, note: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            placeholder="Optional"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add event
          </button>
        </div>
      </form>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-zinc-600">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">
            Employee
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">Everyone</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {employeeFullName(emp)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-500">Loading flags…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-800">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Employee</th>
                  <th className="px-2 py-2">Flag</th>
                  <th className="px-2 py-2">Minutes</th>
                  <th className="px-2 py-2">Shift</th>
                  <th className="px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="px-2 py-2 whitespace-nowrap">{event.event_date_label}</td>
                    <td className="px-2 py-2 font-medium">{event.employee_name}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${typeBadge(event.event_type)}`}>
                        {event.event_type_label}
                      </span>
                      <span className="mt-1 block text-[10px] text-zinc-400">
                        {event.auto_generated ? "Auto" : "Manual"}
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{minutesLabel(event)}</td>
                    <td className="px-2 py-2 text-zinc-600">{event.shift_label}</td>
                    <td className="px-2 py-2">
                      <textarea
                        rows={2}
                        value={noteDrafts[event.id] ?? event.note}
                        onChange={(e) => setNoteDrafts((s) => ({ ...s, [event.id]: e.target.value }))}
                        className="w-full rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                      />
                      {noteDrafts[event.id] != null && noteDrafts[event.id] !== event.note ? (
                        <button
                          type="button"
                          onClick={() => saveNote(event.id)}
                          className="mt-1 text-xs font-semibold text-[#C8102E]"
                        >
                          Save note
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {events.length === 0 ? (
                  <tr>
                    <td className="px-2 py-4 text-zinc-500" colSpan={6}>
                      No attendance flags in this range. Re-scan after punches post, or add a call-out.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
