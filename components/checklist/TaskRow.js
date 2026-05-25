"use client";

import { useRef } from "react";
import { isPhotoMethod } from "@/lib/checklist";
import { formatStoreTime } from "@/lib/store-time";

function CheckboxIcon({ checked }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 text-lg ${
        checked
          ? "border-green-600 bg-green-50 text-green-700 dark:bg-green-950"
          : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
      }`}
      aria-hidden="true"
    >
      {checked ? "✓" : ""}
    </span>
  );
}

function CameraIcon({ done }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 text-xl ${
        done
          ? "border-green-600 bg-green-50 dark:bg-green-950"
          : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
      }`}
      aria-hidden="true"
    >
      📷
    </span>
  );
}

export default function TaskRow({
  row,
  completionDate,
  onComplete,
  onUncomplete,
  onPhoto,
  busy = false,
}) {
  const fileRef = useRef(null);
  const { task, completion, completionShift } = row;
  const done = Boolean(completion);
  const photoTask = isPhotoMethod(task.verification_method);

  async function handleCheckboxClick() {
    if (busy) return;
    if (done) {
      const ok = window.confirm("Mark as incomplete?");
      if (!ok) return;
      await onUncomplete({
        completion_id: completion.id,
        task_id: task.id,
        shift: completionShift,
        completion_date: completionDate,
      });
      return;
    }
    await onComplete({
      task_id: task.id,
      shift: completionShift,
      completion_date: completionDate,
    });
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    if (done) {
      const ok = window.confirm("Mark as incomplete and retake photo?");
      if (!ok) return;
      await onUncomplete({
        completion_id: completion.id,
        task_id: task.id,
        shift: completionShift,
        completion_date: completionDate,
      });
    }
    await onPhoto({
      task_id: task.id,
      shift: completionShift,
      completion_date: completionDate,
      file,
    });
  }

  return (
    <li className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        {photoTask ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="shrink-0 disabled:opacity-50"
              aria-label={done ? `Photo completed for ${task.title}` : `Take photo for ${task.title}`}
            >
              <CameraIcon done={done} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelected}
            />
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={handleCheckboxClick}
            className="shrink-0 disabled:opacity-50"
            aria-label={done ? `Uncheck ${task.title}` : `Complete ${task.title}`}
          >
            <CheckboxIcon checked={done} />
          </button>
        )}

        <div className="min-w-0 flex-1 pt-1">
          <p className={`font-medium ${done ? "text-zinc-400 line-through" : ""}`}>{task.title}</p>
          {task.description ? (
            <p className="mt-0.5 text-xs text-zinc-500">{task.description}</p>
          ) : null}
          {done && completion ? (
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              ✓ {completion.completed_by_name} at {formatStoreTime(completion.completed_at)}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
