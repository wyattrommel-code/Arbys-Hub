"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { compressImageFile } from "@/lib/image-compress";
import TaskRow from "./TaskRow";

export default function ChecklistWidget({
  mode = "current",
  showViewAll = false,
  showManageLink = false,
  isManager = false,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/checklist/tasks?mode=${mode}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      setError(err.message);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  const handleComplete = useCallback(
    async (payload) => {
      setBusyId(payload.task_id);
      const prev = data;
      if (mode === "current" && prev?.rows) {
        setData({
          ...prev,
          rows: prev.rows.map((row) =>
            row.task.id === payload.task_id
              ? {
                  ...row,
                  completion: {
                    completed_by_name: "You",
                    completed_at: new Date().toISOString(),
                  },
                }
              : row
          ),
          completeCount: prev.completeCount + 1,
        });
      }
      try {
        const res = await fetch("/api/checklist/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed");
        await load();
      } catch (err) {
        setData(prev);
        setError(err.message);
      } finally {
        setBusyId(null);
      }
    },
    [data, load, mode]
  );

  const handleUncomplete = useCallback(
    async (payload) => {
      setBusyId(payload.task_id);
      const prev = data;
      if (mode === "current" && prev?.rows) {
        setData({
          ...prev,
          rows: prev.rows.map((row) =>
            row.task.id === payload.task_id ? { ...row, completion: null } : row
          ),
          completeCount: Math.max(0, prev.completeCount - 1),
        });
      }
      try {
        const res = await fetch("/api/checklist/complete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed");
        await load();
      } catch (err) {
        setData(prev);
        setError(err.message);
      } finally {
        setBusyId(null);
      }
    },
    [data, load, mode]
  );

  const handlePhoto = useCallback(
    async ({ file, ...payload }) => {
      setBusyId(payload.task_id);
      try {
        const compressed = await compressImageFile(file);
        const form = new FormData();
        form.append("file", compressed);
        form.append("task_id", payload.task_id);
        form.append("shift", payload.shift);
        form.append("completion_date", payload.completion_date);
        const res = await fetch("/api/checklist/upload", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
        await load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        Loading checklist…
      </div>
    );
  }

  if (mode === "full") {
    const amDone = data.am.filter((r) => r.completion).length;
    const pmDone = data.pm.filter((r) => r.completion).length;
    return (
      <div className="space-y-6">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            AM ({amDone}/{data.am.length})
          </h3>
          <ul className="rounded-xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
            {data.am.length === 0 ? (
              <li className="py-4 text-sm text-zinc-500">No AM tasks today.</li>
            ) : (
              data.am.map((row) => (
                <TaskRow
                  key={`am-${row.task.id}`}
                  row={row}
                  completionDate={data.date}
                  onComplete={handleComplete}
                  onUncomplete={handleUncomplete}
                  onPhoto={handlePhoto}
                  busy={busyId === row.task.id}
                />
              ))
            )}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            PM ({pmDone}/{data.pm.length})
          </h3>
          <ul className="rounded-xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
            {data.pm.length === 0 ? (
              <li className="py-4 text-sm text-zinc-500">No PM tasks today.</li>
            ) : (
              data.pm.map((row) => (
                <TaskRow
                  key={`pm-${row.task.id}`}
                  row={row}
                  completionDate={data.date}
                  onComplete={handleComplete}
                  onUncomplete={handleUncomplete}
                  onPhoto={handlePhoto}
                  busy={busyId === row.task.id}
                />
              ))
            )}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[#C8102E]/20 bg-white shadow-sm dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-semibold text-[#C8102E]">Today&apos;s Checklist</h2>
          <p className="text-sm text-zinc-500">
            {data.completeCount} of {data.totalCount} complete · {data.shift} shift
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {showManageLink && isManager ? (
            <Link href="/checklist/manage" className="text-xs font-semibold text-[#C8102E] hover:underline">
              Manage Tasks
            </Link>
          ) : null}
          {showViewAll ? (
            <Link href="/checklist" className="text-xs font-semibold text-zinc-600 hover:underline dark:text-zinc-300">
              View all →
            </Link>
          ) : null}
        </div>
      </div>
      {error ? <p className="px-4 pt-2 text-sm text-red-600">{error}</p> : null}
      <ul className="px-4">
        {data.rows.length === 0 ? (
          <li className="py-4 text-sm text-zinc-500">No tasks for this shift.</li>
        ) : (
          data.rows.map((row) => (
            <TaskRow
              key={row.task.id}
              row={row}
              completionDate={data.date}
              onComplete={handleComplete}
              onUncomplete={handleUncomplete}
              onPhoto={handlePhoto}
              busy={busyId === row.task.id}
            />
          ))
        )}
      </ul>
    </section>
  );
}
