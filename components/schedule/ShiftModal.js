"use client";

import { useMemo, useState } from "react";
import {
  computeScheduledHours,
  formatHours,
  formatLongDate,
  fromTimeInput,
  parseStationNames,
  serializeStationNames,
  SHIFT_ROLE_OPTIONS,
  timeInputValue,
  UNASSIGNED_ROW_ID,
  unpaidBreakMinutes,
} from "@/lib/schedule";

export default function ShiftModal({
  mode = "create",
  draft,
  employees,
  hoursByRow,
  stations,
  roles,
  onClose,
  onSave,
  onDelete,
}) {
  const [start, setStart] = useState(timeInputValue(draft?.scheduled_start));
  const [end, setEnd] = useState(timeInputValue(draft?.scheduled_end));
  const [employeeId, setEmployeeId] = useState(draft?.employeeId || UNASSIGNED_ROW_ID);
  const [role, setRole] = useState(draft?.role || "");
  const [selectedStations, setSelectedStations] = useState(() => parseStationNames(draft?.station));
  const [breakMinutes, setBreakMinutes] = useState(unpaidBreakMinutes(draft?.unpaid_break_minutes));
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const roleOptions = useMemo(() => {
    const extra = (roles || []).filter(Boolean);
    return [...new Set([...SHIFT_ROLE_OPTIONS, ...extra, role].filter(Boolean))];
  }, [roles, role]);

  const hours = computeScheduledHours(fromTimeInput(start), fromTimeInput(end), breakMinutes);

  function toggleStation(name) {
    setSelectedStations((current) =>
      current.includes(name) ? current.filter((s) => s !== name) : [...current, name]
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    const scheduledStart = fromTimeInput(start);
    const scheduledEnd = fromTimeInput(end);
    if (!scheduledStart || !scheduledEnd) return;
    const employee = employees.find((e) => e.id === employeeId) || employees.find((e) => e.isUnassigned);
    onSave({
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      employee,
      role: role.trim() || null,
      station: serializeStationNames(selectedStations),
      unpaid_break_minutes: unpaidBreakMinutes(breakMinutes),
      scheduled_hours: hours,
      saveAsTemplate,
      templateName: templateName.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold text-[#C8102E]">
          {mode === "edit" ? "Edit Shift" : "Create Shift"}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {formatLongDate(draft.shift_date)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Shift Start Time
            <input
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Shift End Time
            <input
              type="time"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>

        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Employee
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {employees.map((emp) => {
              const weekly = hoursByRow?.get(emp.id) || 0;
              const label = emp.isUnassigned
                ? "Unassign (open shift)"
                : `${emp.fullName} (${formatHours(weekly)})`;
              return (
                <option key={emp.id} value={emp.id}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>

        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Select role…</option>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Or type a custom role"
          className="mt-2 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />

        <fieldset className="mt-3">
          <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Stations</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {stations.map((station) => {
              const checked = selectedStations.includes(station.name);
              return (
                <label
                  key={station.id}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${
                    checked
                      ? "border-[#C8102E] bg-[#C8102E]/10 font-semibold text-[#C8102E]"
                      : "border-zinc-200 text-zinc-600 dark:border-zinc-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleStation(station.name)}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: station.color || "#6b7280" }}
                  />
                  {station.name}
                </label>
              );
            })}
            {stations.length === 0 ? (
              <p className="text-xs text-zinc-500">No stations yet. Add them under Stations.</p>
            ) : null}
          </div>
        </fieldset>

        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Unpaid Break (Minutes)
          <input
            type="number"
            min="0"
            step="1"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(unpaidBreakMinutes(e.target.value))}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <p className="mt-2 text-xs text-zinc-500">{formatHours(hours)} paid scheduled hours</p>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Save as template
            <span className="block text-xs text-zinc-500">Reuse this shift’s times, role, and stations.</span>
          </span>
        </label>
        {saveAsTemplate ? (
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name (optional)"
            className="mt-2 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        ) : null}

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {mode === "edit" ? (
            <button
              type="button"
              onClick={() => onDelete()}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
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
