"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { roleDisplayName, verificationMethodLabel } from "@/lib/checklist-roles";
import { addDaysISO, formatStoreTime, getStoreToday } from "@/lib/store-time";

function NotesSnippet({ text }) {
  const [expanded, setExpanded] = useState(false);
  const full = text == null ? "" : String(text).trim();
  if (!full) return <span className="text-zinc-400">—</span>;
  if (full.length <= 80) {
    return (
      <span className="text-zinc-700 dark:text-zinc-300" title={full}>
        {full}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="max-w-[14rem] cursor-pointer text-left text-xs text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
      title={full}
      onClick={() => setExpanded((x) => !x)}
    >
      {expanded ? full : `${full.slice(0, 80)}…`}
    </button>
  );
}

function ReportsContent() {
  const today = getStoreToday();
  const [start, setStart] = useState(addDaysISO(today, -6));
  const [end, setEnd] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [shift, setShift] = useState("");
  const [role, setRole] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams({ start, end });
    if (employeeId) params.set("employee_id", employeeId);
    if (taskId) params.set("task_id", taskId);
    if (shift) params.set("shift", shift);
    if (role) params.set("role", role);
    try {
      const res = await fetch(`/api/checklist/reports?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      setError(err.message);
    }
  }, [start, end, employeeId, taskId, shift, role]);

  useEffect(() => {
    load();
  }, [load]);

  const employeeNameById = useMemo(() => {
    const map = new Map();
    for (const e of data?.employees || []) {
      map.set(e.id, `${e.first_name} ${e.last_name}`.trim());
    }
    return map;
  }, [data?.employees]);

  function exportCsv() {
    if (!data?.completions?.length) return;
    const header = [
      "Date",
      "Shift",
      "Role",
      "Task",
      "Completed By",
      "Time",
      "Method",
      "Notes",
      "Photo URL",
    ];
    const rows = data.completions.map((c) => [
      c.completion_date,
      c.shift,
      roleDisplayName(c.checklist_tasks?.role),
      c.checklist_tasks?.title || "",
      c.completed_by_name || "",
      formatStoreTime(c.completed_at),
      verificationMethodLabel(c.verification_method || c.checklist_tasks?.verification_method),
      (c.notes || "").replace(/\r?\n/g, " "),
      c.photo_url || "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checklist-report-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <h2 className="text-xl font-semibold">Checklist History</h2>
      <p className="mt-1 text-sm text-zinc-500">Completions and missed tasks</p>

      <div className="mt-4 flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">From</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">To</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Employee</span>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">All</option>
            {(data?.employees || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.first_name} {e.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Task</span>
          <select
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">All</option>
            {(data?.tasks || []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Shift</span>
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">All</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">All</option>
            {(data?.roles || []).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Shift</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Completed By</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Photo</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : data.completions.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-zinc-500">
                  No completions in this range.
                </td>
              </tr>
            ) : (
              data.completions.map((c) => (
                <tr key={c.id} className="border-b border-zinc-50 dark:border-zinc-800">
                  <td className="px-3 py-2">{c.completion_date}</td>
                  <td className="px-3 py-2">{c.shift}</td>
                  <td className="px-3 py-2">{roleDisplayName(c.checklist_tasks?.role)}</td>
                  <td className="px-3 py-2">{c.checklist_tasks?.title || "—"}</td>
                  <td className="px-3 py-2">{c.completed_by_name}</td>
                  <td className="px-3 py-2">{formatStoreTime(c.completed_at)}</td>
                  <td className="px-3 py-2">
                    {verificationMethodLabel(
                      c.verification_method || c.checklist_tasks?.verification_method
                    )}
                  </td>
                  <td className="max-w-[12rem] px-3 py-2 align-top">
                    <NotesSnippet text={c.notes} />
                  </td>
                  <td className="px-3 py-2">
                    {c.photo_url ? (
                      <button type="button" onClick={() => setLightbox(c.photo_url)}>
                        <img src={c.photo_url} alt="" className="h-10 w-10 rounded object-cover" />
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data?.summary ? (
        <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="font-semibold">Summary</h3>
          <p className="text-sm">Total completions: {data.summary.totalCompletions}</p>
          <div>
            <p className="mb-1 text-sm font-medium">Completions per employee</p>
            <ul className="text-sm text-zinc-600 dark:text-zinc-400">
              {Object.entries(data.summary.perEmployee).map(([id, count]) => (
                <li key={id}>
                  {employeeNameById.get(id) || id}: {count}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Uncompleted scheduled tasks</p>
            {data.summary.uncompleted.length === 0 ? (
              <p className="text-sm text-zinc-500">None — all scheduled tasks completed.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-400">
                {data.summary.uncompleted.slice(0, 50).map((u) => (
                  <li key={`${u.completion_date}-${u.shift}-${u.task_id}`}>
                    {u.completion_date} · {u.shift} · {u.task_title}
                  </li>
                ))}
                {data.summary.uncompleted.length > 50 ? (
                  <li className="text-zinc-500">…and {data.summary.uncompleted.length - 50} more</li>
                ) : null}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <img src={lightbox} alt="Completion photo" className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}
    </section>
  );
}

export default function ChecklistReportsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading…</p>}>
      <ReportsContent />
    </Suspense>
  );
}
