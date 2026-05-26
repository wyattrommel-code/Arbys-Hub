"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { compressImageFile } from "@/lib/image-compress";
import ChecklistRoleSections from "./ChecklistRoleSections";

function patchSections(sections, payload, completionPatch) {
  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => {
      if (row.task.id !== payload.task_id || row.completionShift !== payload.shift) return row;
      const completion = completionPatch === null ? null : { ...row.completion, ...completionPatch };
      return { ...row, completion };
    }),
    completeCount: 0,
    totalCount: section.rows.length,
  })).map((section) => ({
    ...section,
    completeCount: section.rows.filter((r) => r.completion).length,
  }));
}

export default function ChecklistWidget({
  /** Full daily view: all roles for today. */
  fullDay = false,
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
      const qs = new URLSearchParams();
      qs.set("view", fullDay ? "roles-full" : "roles");
      const res = await fetch(`/api/checklist/tasks?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      setError(err.message);
    }
  }, [fullDay]);

  useEffect(() => {
    load();
  }, [load]);

  const handleComplete = useCallback(
    async (payload) => {
      setBusyId(`${payload.shift}-${payload.task_id}`);
      const prev = data;
      if (prev?.sections) {
        setData({
          ...prev,
          sections: patchSections(prev.sections, payload, {
            completed_by_name: "You",
            completed_at: new Date().toISOString(),
            notes: payload.notes || null,
          }),
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
    [data, load]
  );

  const handleUncomplete = useCallback(
    async (payload) => {
      setBusyId(`${payload.shift}-${payload.task_id}`);
      const prev = data;
      if (prev?.sections) {
        setData({
          ...prev,
          sections: patchSections(prev.sections, payload, null),
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
    [data, load]
  );

  const handlePhoto = useCallback(
    async ({ file, notes, ...payload }) => {
      setBusyId(`${payload.shift}-${payload.task_id}`);
      try {
        const compressed = await compressImageFile(file);
        const form = new FormData();
        form.append("file", compressed);
        form.append("task_id", payload.task_id);
        form.append("shift", payload.shift);
        form.append("completion_date", payload.completion_date);
        if (notes) form.append("notes", notes);
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

  const handleSaveNote = useCallback(
    async ({ completion_id, notes }) => {
      try {
        const res = await fetch("/api/checklist/complete", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completion_id, notes }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to save note");
        await load();
      } catch (err) {
        setError(err.message);
      }
    },
    [load]
  );

  const rowBusy = (row) => busyId === `${row.completionShift}-${row.task.id}`;

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

  const sections = data.sections || [];

  if (fullDay) {
    return (
      <div className="space-y-3">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <ChecklistRoleSections
          sections={sections}
          completionDate={data.date}
          onComplete={handleComplete}
          onUncomplete={handleUncomplete}
          onPhoto={handlePhoto}
          onSaveNote={handleSaveNote}
          rowBusy={rowBusy}
          scrollableLists
        />
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
      <div className="p-3">
        <ChecklistRoleSections
          sections={sections}
          completionDate={data.date}
          onComplete={handleComplete}
          onUncomplete={handleUncomplete}
          onPhoto={handlePhoto}
          onSaveNote={handleSaveNote}
          rowBusy={rowBusy}
        />
      </div>
    </section>
  );
}
