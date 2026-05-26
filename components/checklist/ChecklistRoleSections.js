"use client";

import { useState } from "react";
import TaskRow from "./TaskRow";

export default function ChecklistRoleSections({
  sections,
  completionDate,
  onComplete,
  onUncomplete,
  onPhoto,
  onSaveNote,
  rowBusy,
  scrollableLists = false,
}) {
  const [expanded, setExpanded] = useState(() => ({}));

  function isExpanded(role) {
    return Boolean(expanded[role]);
  }

  function toggle(role) {
    setExpanded((prev) => ({ ...prev, [role]: !prev[role] }));
  }

  if (!sections?.length) {
    return <p className="py-4 text-sm text-zinc-500">No tasks scheduled for today.</p>;
  }

  return (
    <div className="space-y-3">
      {sections.map((section) => {
        const open = isExpanded(section.role);
        const listClass = scrollableLists
          ? "max-h-[min(45vh,24rem)] overflow-y-auto overflow-x-hidden md:max-h-none md:overflow-visible"
          : "";

        return (
          <section
            key={section.role}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => toggle(section.role)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              aria-expanded={open}
            >
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">{section.label}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <span>
                  {section.completeCount} of {section.totalCount} complete
                </span>
                <span className="text-zinc-400" aria-hidden="true">
                  {open ? "▾" : "▸"}
                </span>
              </span>
            </button>
            {open ? (
              <ul className={`border-t border-zinc-100 px-4 dark:border-zinc-800 ${listClass}`}>
                {section.rows.map((row) => (
                  <TaskRow
                    key={`${section.role}-${row.completionShift}-${row.task.id}`}
                    row={row}
                    completionDate={completionDate}
                    onComplete={onComplete}
                    onUncomplete={onUncomplete}
                    onPhoto={onPhoto}
                    onSaveNote={onSaveNote}
                    busy={rowBusy(row)}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
