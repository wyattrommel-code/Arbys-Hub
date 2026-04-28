"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const STORE_ID = "payson";

const SHIFT_OPTIONS = {
  MORNING: {
    label: "Morning",
    cutoffHour: 10,
    cutoffMinute: 30,
  },
  NIGHT: {
    label: "Night",
    cutoffHour: 16,
    cutoffMinute: 30,
  },
};

const STATIONS = [
  "DT Order Taker",
  "DT Cashier",
  "Runner",
  "Front",
  "Fryer",
  "Slicer",
  "Backline",
  "Floater",
];

const SUBMITTERS = [
  "Jared Campbell",
  "Jesus Martinez",
  "Myriam Cortez",
  "Cole Palmer",
  "Ryan Meade",
  "Darrin Proctor",
  "Wyatt Rommel",
];

function toDateStr(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtLongDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTimeRange(start, end) {
  return `${fmtClock(start)} - ${fmtClock(end)}`;
}

function fmtClock(timeText) {
  const m = String(timeText || "").trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return "—";
  const hour24 = Number(m[1]);
  const minute = Number(m[2]);
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

function toMinutes(timeText) {
  const m = String(timeText || "").trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isMorningDeploymentShift(row) {
  const startMin = toMinutes(row?.scheduled_start);
  if (!Number.isFinite(startMin)) return false;
  return startMin < 15 * 60;
}

function isNightDeploymentShift(row) {
  const endMin = toMinutes(row?.scheduled_end);
  if (!Number.isFinite(endMin)) return false;
  return endMin > 15 * 60;
}

function isLeadRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized.includes("day lead") || normalized.includes("night lead");
}

function formatSubmittedTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function createEmployeeRow(values = {}) {
  return {
    id: values.id || crypto.randomUUID(),
    employee_name: values.employee_name || "",
    role: values.role || "",
    scheduled_start: values.scheduled_start || null,
    scheduled_end: values.scheduled_end || null,
    notes: values.notes || "",
    stations: values.stations || [],
    unscheduled: Boolean(values.unscheduled),
  };
}

export default function DeploymentPage() {
  const today = useMemo(() => toDateStr(new Date()), []);
  const supabase = useMemo(() => getSupabase(), []);
  const [logDate, setLogDate] = useState(today);
  const [shiftKey, setShiftKey] = useState("MORNING");
  const [submittedBy, setSubmittedBy] = useState("");
  const [employees, setEmployees] = useState([]);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [unscheduledEmployeeId, setUnscheduledEmployeeId] = useState("");
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [existingLog, setExistingLog] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successState, setSuccessState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchDeploymentInputData() {
      setLoadingSchedule(true);
      setFetchError("");
      setExistingLog(null);
      try {
        const shiftDef = SHIFT_OPTIONS[shiftKey];
        const [{ data: schedRows, error: schedErr }, { data: existingRows, error: existingErr }] = await Promise.all([
          supabase
            .from("schedule_shifts")
            .select("employee_name, role, scheduled_start, scheduled_end")
            .eq("shift_date", logDate)
            .eq("store_id", STORE_ID),
          supabase
            .from("deployment_logs")
            .select("id, submitted_by, submitted_at")
            .eq("log_date", logDate)
            .eq("shift", shiftDef.label)
            .eq("store_id", STORE_ID)
            .order("submitted_at", { ascending: false })
            .limit(1),
        ]);

        if (schedErr) throw schedErr;
        if (existingErr) throw existingErr;
        if (cancelled) return;

        const overlapFiltered = (schedRows || []).filter((row) =>
          shiftKey === "MORNING" ? isMorningDeploymentShift(row) : isNightDeploymentShift(row)
        );

        const mapped = overlapFiltered
          .map((row) =>
            createEmployeeRow({
              employee_name: row.employee_name,
              role: row.role,
              scheduled_start: row.scheduled_start,
              scheduled_end: row.scheduled_end,
            })
          )
          .sort((a, b) => {
            return toMinutes(a.scheduled_start) - toMinutes(b.scheduled_start);
          });

        setEmployees(mapped);
        setExistingLog(existingRows?.[0] || null);
      } catch (err) {
        if (!cancelled) {
          setEmployees([]);
          setExistingLog(null);
          setFetchError(err?.message || "Failed to load schedule.");
        }
      } finally {
        if (!cancelled) setLoadingSchedule(false);
      }
    }
    if (logDate && shiftKey) fetchDeploymentInputData();
    return () => {
      cancelled = true;
    };
  }, [logDate, shiftKey]);

  useEffect(() => {
    let cancelled = false;
    async function fetchActiveEmployees() {
      const { data, error: empErr } = await supabase
        .from("employees")
        .select("id, first_name, last_name, status")
        .eq("status", "active")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true });
      if (cancelled) return;
      if (empErr) {
        setFetchError(empErr.message || "Failed to load active employees.");
        setActiveEmployees([]);
        return;
      }
      setActiveEmployees(
        (data || []).map((row) => ({
          id: row.id,
          name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
        }))
      );
    }
    fetchActiveEmployees();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const coverage = useMemo(() => {
    const out = Object.fromEntries(STATIONS.map((station) => [station, []]));
    for (const row of employees) {
      const name = String(row.employee_name || "").trim();
      if (!name) continue;
      for (const station of row.stations || []) {
        if (!out[station]) out[station] = [];
        out[station].push(name);
      }
    }
    return out;
  }, [employees]);

  const assignedRows = useMemo(
    () => employees.filter((row) => String(row.employee_name || "").trim() && (row.stations || []).length > 0),
    [employees]
  );

  function toggleStation(employeeId, station) {
    setEmployees((prev) =>
      prev.map((row) => {
        if (row.id !== employeeId) return row;
        const has = row.stations.includes(station);
        return {
          ...row,
          stations: has ? row.stations.filter((s) => s !== station) : [...row.stations, station],
        };
      })
    );
  }

  function setRowField(employeeId, field, value) {
    setEmployees((prev) => prev.map((row) => (row.id === employeeId ? { ...row, [field]: value } : row)));
  }

  function addUnscheduledPerson() {
    if (!unscheduledEmployeeId) return;
    const selected = activeEmployees.find((row) => row.id === unscheduledEmployeeId);
    if (!selected) return;
    const alreadyIncluded = employees.some(
      (row) => String(row.employee_name || "").trim().toLowerCase() === selected.name.toLowerCase()
    );
    if (alreadyIncluded) return;
    setEmployees((prev) =>
      prev.concat(
        createEmployeeRow({
          employee_name: selected.name,
          role: "Unscheduled",
          unscheduled: true,
        })
      )
    );
    setUnscheduledEmployeeId("");
  }

  function calcLateStatus(shiftDef, submissionDate, dateStr) {
    const cutoff = new Date(`${dateStr}T00:00:00`);
    cutoff.setHours(shiftDef.cutoffHour, shiftDef.cutoffMinute, 0, 0);
    if (submissionDate <= cutoff) return { isLate: false, minutesLate: 0 };
    return {
      isLate: true,
      minutesLate: Math.max(1, Math.round((submissionDate.getTime() - cutoff.getTime()) / 60000)),
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError("");
    const shiftDef = SHIFT_OPTIONS[shiftKey];
    if (!submittedBy) {
      setSubmitError("Please choose who is submitting this deployment.");
      return;
    }
    if (assignedRows.length === 0) {
      setSubmitError("Assign at least one station before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const submittedAt = new Date();
      const { isLate, minutesLate } = calcLateStatus(shiftDef, submittedAt, logDate);

      const { data: upsertedLog, error: upsertErr } = await supabase
        .from("deployment_logs")
        .upsert(
          {
            log_date: logDate,
            shift: shiftDef.label,
            submitted_by: submittedBy,
            submitted_at: submittedAt.toISOString(),
            is_late: isLate,
            minutes_late: minutesLate,
            store_id: STORE_ID,
          },
          { onConflict: "log_date,shift,store_id" }
        )
        .select("id, submitted_by, submitted_at, is_late, minutes_late")
        .single();
      if (upsertErr) throw upsertErr;

      const deploymentId = upsertedLog?.id;
      if (!deploymentId) throw new Error("Could not resolve deployment id.");

      const { error: deleteErr } = await supabase.from("deployment_assignments").delete().eq("deployment_id", deploymentId);
      if (deleteErr) throw deleteErr;

      const insertRows = assignedRows.map((row) => ({
        deployment_id: deploymentId,
        log_date: logDate,
        shift: shiftDef.label,
        employee_name: row.employee_name.trim(),
        stations: row.stations,
        notes: row.notes?.trim() || null,
      }));

      const { error: insertErr } = await supabase.from("deployment_assignments").insert(insertRows);
      if (insertErr) throw insertErr;

      setSuccessState({
        logDate,
        shift: shiftDef.label,
        submittedBy,
        isLate,
        minutesLate,
        assignedCount: insertRows.length,
        coverage,
      });
    } catch (err) {
      setSubmitError(err?.message || "Deployment submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function submitAnother() {
    const nextShift = shiftKey === "MORNING" ? "NIGHT" : "MORNING";
    const keepSubmitter = successState?.submittedBy || submittedBy;
    setSuccessState(null);
    setLogDate(today);
    setShiftKey(nextShift);
    setSubmittedBy(keepSubmitter);
    setSubmitError("");
  }

  if (successState) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h2 className="text-2xl font-bold text-[#C8102E]">Deployment Submitted</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {fmtLongDate(successState.logDate)} - {successState.shift}
          </p>
        </div>

        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm">
            <span className="font-semibold">Submitted by:</span> {successState.submittedBy}
          </p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">Status:</span>{" "}
            {successState.isLate ? (
              <span className="font-semibold text-amber-700">Late ⚠️ ({successState.minutesLate} min)</span>
            ) : (
              <span className="font-semibold text-green-700">On time ✅</span>
            )}
          </p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">Employees assigned:</span> {successState.assignedCount}
          </p>
        </article>

        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">STATION COVERAGE</h3>
          <div className="mt-2 space-y-2">
            {STATIONS.map((station) => {
              const names = successState.coverage[station] || [];
              return (
                <p key={station} className="text-sm">
                  <span className="inline-block min-w-[132px] font-semibold">{station}</span>
                  {names.length ? names.join(", ") : <span className="text-zinc-400">(unassigned)</span>}
                </p>
              );
            })}
          </div>
        </article>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href="/schedule?tab=deployment"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#C8102E] px-4 text-sm font-semibold text-[#C8102E] hover:bg-[#C8102E]/5"
          >
            View History
          </Link>
          <button
            type="button"
            onClick={submitAnother}
            className="min-h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white hover:bg-[#ab0d26]"
          >
            Submit Another
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <h2 className="text-2xl font-bold text-[#C8102E]">Deployment Chart</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fmtLongDate(today)}</p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-4">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Date
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Shift</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {["MORNING", "NIGHT"].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setShiftKey(key)}
                    className={`min-h-11 rounded-lg border text-sm font-bold ${
                      shiftKey === key
                        ? "border-[#C8102E] bg-[#C8102E] text-white"
                        : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Morning cutoff: 10:30 AM | Night cutoff: 4:30 PM
              </p>
            </div>

            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Submitted By
              <select
                value={submittedBy}
                onChange={(e) => setSubmittedBy(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Select shift lead...</option>
                {SUBMITTERS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>

        {existingLog ? (
          <article className="rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            <p className="font-semibold">⚠️ Deployment already submitted for this shift</p>
            <p className="mt-1">
              Submitted by {existingLog.submitted_by} at {formatSubmittedTime(existingLog.submitted_at)}.
            </p>
            <p className="mt-1">Resubmitting will overwrite the existing deployment.</p>
          </article>
        ) : null}

        <article className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Employee Station Assignment</h3>
          </div>

          {loadingSchedule ? (
            <p className="p-4 text-sm text-zinc-500">Loading scheduled employees...</p>
          ) : fetchError ? (
            <p className="p-4 text-sm text-red-700">{fetchError}</p>
          ) : employees.length === 0 ? (
            <div className="p-4">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                No schedule found for this date and shift. Upload a schedule CSV on the Import page first.
              </p>
              <Link href="/import" className="mt-2 inline-block text-sm font-semibold text-[#C8102E] underline">
                Go to Import
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {employees.map((row) => (
                <div key={row.id} className="p-4">
                  <div className="mb-3">
                    <input
                      type="text"
                      value={row.employee_name}
                      className="w-full rounded-md border-transparent bg-transparent px-0 py-2 text-sm font-semibold"
                      readOnly
                    />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {row.role || "Role not set"} {row.scheduled_start && row.scheduled_end ? `• ${fmtTimeRange(row.scheduled_start, row.scheduled_end)}` : ""}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {STATIONS.map((station) => {
                      const checked = row.stations.includes(station);
                      return (
                        <label
                          key={`${row.id}-${station}`}
                          className={`flex min-h-11 items-center rounded-lg border px-3 text-sm ${
                            checked
                              ? "border-[#C8102E] bg-[#C8102E]/10 text-[#8f0f24]"
                              : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStation(row.id, station)}
                            className="mr-2 h-4 w-4 accent-[#C8102E]"
                          />
                          {station}
                        </label>
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    value={row.notes}
                    onChange={(e) => setRowField(row.id, "notes", e.target.value)}
                    placeholder="Notes (optional)"
                    className="mt-3 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={unscheduledEmployeeId}
                onChange={(e) => setUnscheduledEmployeeId(e.target.value)}
                className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Select active employee...</option>
                {activeEmployees
                  .filter(
                    (emp) =>
                      !employees.some(
                        (row) => String(row.employee_name || "").trim().toLowerCase() === String(emp.name || "").toLowerCase()
                      )
                  )
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={addUnscheduledPerson}
                disabled={!unscheduledEmployeeId}
                className="min-h-11 rounded-lg border border-[#C8102E] px-4 text-sm font-semibold text-[#C8102E] hover:bg-[#C8102E]/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Add Unscheduled Person
              </button>
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">STATION COVERAGE</h3>
          <div className="mt-3 space-y-2">
            {STATIONS.map((station) => {
              const names = coverage[station] || [];
              const empty = names.length === 0;
              return (
                <p key={station} className="text-sm">
                  <span className={`inline-block min-w-[132px] font-semibold ${empty ? "text-orange-600" : ""}`}>{station}</span>
                  {empty ? (
                    <span className="text-zinc-400">(unassigned)</span>
                  ) : (
                    names.join(", ")
                  )}
                </p>
              );
            })}
          </div>
        </article>

        {submitError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-12 w-full rounded-xl bg-[#C8102E] px-4 text-base font-bold text-white shadow-sm hover:bg-[#ab0d26] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </form>
    </section>
  );
}
