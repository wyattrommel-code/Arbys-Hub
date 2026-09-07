"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import { addDaysISO, getStoreToday, toStoreDateTimeLocal } from "@/lib/store-time";
import { weekStartSunday } from "@/lib/schedule";
import { buildPayrollCsv, payrollFilename } from "@/lib/timecards";

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TimecardsBoard() {
  const today = getStoreToday();
  const weekStart = weekStartSunday(today);
  const [from, setFrom] = useState(weekStart);
  const [to, setTo] = useState(addDaysISO(weekStart, 6));
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/timecards?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load timecards.");
      setPayload(data);
    } catch (err) {
      setError(err.message || "Could not load timecards.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const groups = payload?.groups || [];
    const grandMinutes = groups.reduce((sum, group) => sum + (Number(group.totalMinutes) || 0), 0);
    return {
      groups,
      grandMinutes,
      grandDisplay: payload?.grand_display || "0.00",
      grandExact: payload?.grand_exact,
      openCount: payload?.open_count || 0,
    };
  }, [payload]);

  function setThisWeek() {
    const start = weekStartSunday(getStoreToday());
    setFrom(start);
    setTo(addDaysISO(start, 6));
  }

  function setLastWeek() {
    const start = addDaysISO(weekStartSunday(getStoreToday()), -7);
    setFrom(start);
    setTo(addDaysISO(start, 6));
  }

  function setLast14() {
    const end = getStoreToday();
    setFrom(addDaysISO(end, -13));
    setTo(end);
  }

  function exportCsv() {
    if (!payload) return;
    const csv = buildPayrollCsv(grouped, from, to);
    downloadCsv(payrollFilename(from, to), csv);
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/timecards/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clock_in: editing.clock_in,
          clock_out: editing.clock_out || null,
          note: editing.note || "",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save punch.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message || "Could not save punch.");
    } finally {
      setSaving(false);
    }
  }

  const canEdit = Boolean(payload?.can_edit);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Timecards</h2>
          <p className="text-sm text-zinc-500">
            Exact punch times for payroll. Hours on screen are 2 decimals; the CSV is unrounded
            {payload?.subtract_scheduled_break
              ? " and subtracts each shift's unpaid break."
              : "."}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!payload || loading}
          className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Export payroll CSV
        </button>
      </div>

      {payload?.open_count ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
          {payload.open_count} open punch{payload.open_count === 1 ? "" : "es"} — never clocked out. Fix before paying.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={setThisWeek} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold">
            This week
          </button>
          <button type="button" onClick={setLastWeek} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold">
            Last week
          </button>
          <button type="button" onClick={setLast14} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold">
            Last 14 days
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-zinc-600">
            Pay period start
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">
            Pay period end
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
            <p className="text-xs text-zinc-500">Grand total</p>
            <p className="font-bold">{payload?.grand_display || "0.00"} hrs</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
            <p className="text-xs text-zinc-500">Employees</p>
            <p className="font-bold">{payload?.groups?.length || 0}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
            <p className="text-xs text-zinc-500">Open punches</p>
            <p className="font-bold">{payload?.open_count || 0}</p>
          </div>
        </div>
      </section>

      {loading ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading timecards…</p>
      ) : !payload?.groups?.length ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          No punches in this pay period.
        </p>
      ) : (
        payload.groups.map((group) => (
          <section
            key={group.key}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex min-w-0 items-center gap-3">
                <EmployeeAvatar name={group.name} src={group.profile_photo_url} size="sm" />
                <div className="min-w-0">
                  <p className="font-semibold">{group.name}</p>
                  {group.openCount ? (
                    <p className="text-xs font-medium text-amber-800">{group.openCount} open</p>
                  ) : null}
                </div>
              </div>
              <p className="text-sm font-bold">{group.totalDisplay} hrs</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-800">
                  <tr>
                    <th className="px-3 py-2">Photo</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">In</th>
                    <th className="px-3 py-2">Out</th>
                    <th className="px-3 py-2">Worked</th>
                    <th className="px-3 py-2">Scheduled</th>
                    <th className="px-3 py-2">Status</th>
                    {canEdit ? <th className="px-3 py-2"> </th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.punches.map((punch) => (
                    <tr
                      key={punch.id}
                      className={`border-t border-zinc-100 dark:border-zinc-800 ${punch.open ? "bg-amber-50/80" : ""}`}
                    >
                      <td className="px-3 py-2">
                        {punch.clock_in_photo_url ? (
                          <button
                            type="button"
                            onClick={() => setLightbox(punch)}
                            className="relative block"
                          >
                            <img
                              src={punch.clock_in_photo_url}
                              alt={`Clock-in photo for ${punch.employee_name}`}
                              className="h-12 w-12 rounded-md object-cover"
                            />
                            {!punch.face_detected_in ? (
                              <span className="absolute -right-1 -top-1 rounded bg-red-600 px-1 text-[9px] font-bold text-white">
                                No face
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-400">No photo</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{punch.date_label}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{punch.clock_in_time}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {punch.open ? <span className="font-semibold text-amber-800">Open</span> : punch.clock_out_time}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">
                        {punch.open ? (
                          "—"
                        ) : (
                          <span
                            title={
                              punch.worked_minutes == null
                                ? ""
                                : `${punch.worked_minutes} min ÷ 60${
                                    punch.break_minutes
                                      ? ` (minus ${punch.break_minutes} min scheduled break)`
                                      : ""
                                  }`
                            }
                          >
                            {punch.worked_hours_display} hrs
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{punch.scheduled_label}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {punch.open ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                              Open
                            </span>
                          ) : null}
                          {punch.edited ? (
                            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                              Edited
                            </span>
                          ) : null}
                          {punch.unscheduled ? (
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                              Unscheduled
                            </span>
                          ) : null}
                          {punch.authorized_by ? (
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                              Auth: {punch.authorized_by}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                id: punch.id,
                                name: punch.employee_name,
                                clock_in: toStoreDateTimeLocal(punch.clock_in),
                                clock_out: punch.clock_out ? toStoreDateTimeLocal(punch.clock_out) : "",
                                note: "",
                              })
                            }
                            className="text-xs font-semibold text-[#C8102E]"
                          >
                            Edit
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <p className="text-sm font-semibold text-zinc-700">
        Period total: {payload?.grand_display || "0.00"} hrs
      </p>
      {!canEdit && payload ? (
        <p className="text-xs text-zinc-500">Shift leads can review timecards. GM or assistant manager can correct punches.</p>
      ) : null}

      {lightbox ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setLightbox(null)}>
          <div className="max-h-[90vh] max-w-lg overflow-auto rounded-xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold">
              {lightbox.employee_name} · {lightbox.clock_in_label}
            </p>
            <img src={lightbox.clock_in_photo_url} alt="Clock-in photo" className="max-h-[70vh] w-full rounded-lg object-contain" />
            {!lightbox.face_detected_in ? (
              <p className="mt-2 text-sm font-medium text-red-700">Face was not detected at capture.</p>
            ) : null}
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="mt-3 w-full rounded-lg border border-zinc-300 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <h3 className="text-lg font-semibold text-[#C8102E]">Edit punch</h3>
            <p className="mt-1 text-sm text-zinc-500">{editing.name}</p>
            <label className="mt-4 block text-xs font-medium text-zinc-600">
              Clock in
              <input
                type="datetime-local"
                step="1"
                required
                value={editing.clock_in}
                onChange={(e) => setEditing((s) => ({ ...s, clock_in: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-zinc-600">
              Clock out
              <input
                type="datetime-local"
                step="1"
                value={editing.clock_out}
                onChange={(e) => setEditing((s) => ({ ...s, clock_out: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-zinc-600">
              Note (optional)
              <input
                value={editing.note}
                onChange={(e) => setEditing((s) => ({ ...s, note: e.target.value }))}
                placeholder="Why this was corrected"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
