"use client";

import {
  computeScheduledHours,
  formatHours,
  fromTimeInput,
  timeInputValue,
} from "@/lib/schedule";

export default function ShiftEditModal({ shift, stations, onClose, onSave, onDelete }) {
  if (!shift) return null;

  function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = fromTimeInput(form.get("start"));
    const end = fromTimeInput(form.get("end"));
    if (!start || !end) return;
    onSave({
      scheduled_start: start,
      scheduled_end: end,
      role: String(form.get("role") || "").trim(),
      station: String(form.get("station") || "").trim() || null,
      notes: String(form.get("notes") || "").trim() || null,
      scheduled_hours: computeScheduledHours(start, end),
    });
  }

  const hours = computeScheduledHours(shift.scheduled_start, shift.scheduled_end);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold text-[#C8102E]">Edit shift</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {shift.employee_name} · {shift.shift_date}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Start
            <input
              name="start"
              type="time"
              required
              defaultValue={timeInputValue(shift.scheduled_start)}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            End
            <input
              name="end"
              type="time"
              required
              defaultValue={timeInputValue(shift.scheduled_end)}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>

        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Role
          <input
            name="role"
            type="text"
            defaultValue={shift.role || ""}
            placeholder="Morning, Night Lead…"
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Station
          <select
            name="station"
            defaultValue={shift.station || ""}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">No station</option>
            {stations.map((station) => (
              <option key={station.id} value={station.name}>
                {station.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Notes
          <input
            name="notes"
            type="text"
            defaultValue={shift.notes || ""}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <p className="mt-2 text-xs text-zinc-500">{formatHours(hours)} scheduled</p>

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={() => onDelete(shift)}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
