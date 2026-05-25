"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DAY_OF_WEEK_OPTIONS,
  SHIFT_OPTIONS,
  VERIFICATION_METHOD_OPTIONS,
} from "@/lib/constants";

function emptyTask() {
  return {
    title: "",
    description: "",
    day_of_week: "",
    shift: "BOTH",
    verification_method: "checkbox",
    display_order: 0,
    is_active: true,
  };
}

export default function ManageTasksPanel() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(emptyTask());
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/checklist/tasks?mode=manage");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to load tasks");
      return;
    }
    setTasks(json.tasks || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveTask(id, updates) {
    setSavingId(id || "new");
    setError("");
    try {
      const res = await fetch("/api/checklist/tasks", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id, ...updates } : updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      if (!id) setDraft(emptyTask());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  function updateLocal(id, field, value) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            <tr>
              <th className="px-2 py-2">Order</th>
              <th className="px-2 py-2">Title</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2">Day</th>
              <th className="px-2 py-2">Shift</th>
              <th className="px-2 py-2">Method</th>
              <th className="px-2 py-2">Active</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-b border-zinc-50 dark:border-zinc-800">
                <td className="px-2 py-2">
                  <input
                    type="number"
                    className="w-14 rounded border px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={task.display_order ?? 0}
                    onChange={(e) => updateLocal(task.id, "display_order", Number(e.target.value))}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className="min-w-[8rem] rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={task.title || ""}
                    onChange={(e) => updateLocal(task.id, "title", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className="min-w-[8rem] rounded border px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={task.description || ""}
                    onChange={(e) => updateLocal(task.id, "description", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    className="rounded border px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={task.day_of_week == null ? "" : String(task.day_of_week)}
                    onChange={(e) =>
                      updateLocal(task.id, "day_of_week", e.target.value === "" ? null : e.target.value)
                    }
                  >
                    {DAY_OF_WEEK_OPTIONS.map((o) => (
                      <option key={o.label} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    className="rounded border px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={task.shift || "BOTH"}
                    onChange={(e) => updateLocal(task.id, "shift", e.target.value)}
                  >
                    {SHIFT_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    className="rounded border px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={task.verification_method || "checkbox"}
                    onChange={(e) => updateLocal(task.id, "verification_method", e.target.value)}
                  >
                    {VERIFICATION_METHOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={task.is_active !== false}
                    onChange={(e) => updateLocal(task.id, "is_active", e.target.checked)}
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    disabled={savingId === task.id}
                    onClick={() => saveTask(task.id, task)}
                    className="rounded bg-[#C8102E] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <h3 className="mb-3 font-semibold">Add new task</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            placeholder="Title"
            className="rounded border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            placeholder="Description (optional)"
            className="rounded border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
          <select
            className="rounded border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            value={draft.day_of_week}
            onChange={(e) => setDraft((d) => ({ ...d, day_of_week: e.target.value }))}
          >
            {DAY_OF_WEEK_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="rounded border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            value={draft.shift}
            onChange={(e) => setDraft((d) => ({ ...d, shift: e.target.value }))}
          >
            {SHIFT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="rounded border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            value={draft.verification_method}
            onChange={(e) => setDraft((d) => ({ ...d, verification_method: e.target.value }))}
          >
            {VERIFICATION_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Display order"
            className="rounded border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            value={draft.display_order}
            onChange={(e) => setDraft((d) => ({ ...d, display_order: Number(e.target.value) }))}
          />
        </div>
        <button
          type="button"
          disabled={!draft.title.trim() || savingId === "new"}
          onClick={() => saveTask(null, draft)}
          className="mt-3 rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add new task
        </button>
      </div>
    </div>
  );
}
