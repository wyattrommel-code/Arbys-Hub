"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchActiveEmployees } from "@/lib/employees";
import { canAccess } from "@/lib/permissions";
import { getSupabase } from "@/lib/supabase";
import { DEPLOYMENT_STATIONS } from "@/lib/kitchen-report";
import { getStoreToday, formatStoreDateTime, fromStoreDateTimeLocal, toStoreDateTimeLocal } from "@/lib/store-time";

const STORE_ID = "payson";

const SHIFT_OPTIONS = {
  MORNING: {
    label: "Morning",
    cutoffHour: 10,
    cutoffMinute: 30,
    roles: ["Breakfast", "Open", "Morning", "Day Lead", "Mid Shift"],
  },
  NIGHT: {
    label: "Night",
    cutoffHour: 16,
    cutoffMinute: 30,
    roles: ["Night", "Night Lead", "Closing", "Mid Shift"],
  },
};

const STATIONS = DEPLOYMENT_STATIONS;

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

function includeForShiftByRole(role, shiftKey) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const morningRoles = SHIFT_OPTIONS.MORNING.roles.map((r) => r.toLowerCase());
  const nightRoles = SHIFT_OPTIONS.NIGHT.roles.map((r) => r.toLowerCase());
  const isMorningRole = morningRoles.includes(normalizedRole);
  const isNightRole = nightRoles.includes(normalizedRole);

  // Unknown/custom roles are included on both deployments so nobody is missed.
  if (!isMorningRole && !isNightRole) return true;
  return shiftKey === "MORNING" ? isMorningRole : isNightRole;
}

function isLeadRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized.includes("day lead") || normalized.includes("night lead");
}

function createEmployeeRow(values = {}) {
  return {
    id: values.id || crypto.randomUUID(),
    employee_id: values.employee_id || null,
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
  const today = useMemo(() => getStoreToday(), []);
  const supabase = useMemo(() => getSupabase(), []);
  const [logDate, setLogDate] = useState(today);
  const [shiftKey, setShiftKey] = useState("MORNING");
  const [submittedBy, setSubmittedBy] = useState("");
  const [employees, setEmployees] = useState([]);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [versions, setVersions] = useState([]);
  const [effectiveTime, setEffectiveTime] = useState("");
  const [reload, setReload] = useState(0);
  const saveAttempt = useRef(null);
  const [unscheduledEmployeeId, setUnscheduledEmployeeId] = useState("");
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [existingLog, setExistingLog] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successState, setSuccessState] = useState(null);
  const [canSubmit, setCanSubmit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.employee?.role) {
          setCanSubmit(canAccess(json.employee.role, "deployment.submit"));
          setSubmittedBy(`${json.employee.first_name || ""} ${json.employee.last_name || ""}`.trim());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchDeploymentInputData() {
      setLoadingSchedule(true);
      setFetchError("");
      setExistingLog(null);
      try {
        const [{ data: schedRows, error: schedErr }, history, active] = await Promise.all([
          supabase
            .from("schedule_shifts")
            .select("employee_id, employee_name, role, scheduled_start, scheduled_end")
            .eq("shift_date", logDate)
            .eq("store_id", STORE_ID),
          fetch(`/api/deployment?date=${logDate}`).then(async res=>{const json=await res.json(); if(!res.ok) throw new Error(json.error); return json;}),
          fetchActiveEmployees(supabase),
        ]);

        if (schedErr) throw schedErr;
        if (cancelled) return;

        const overlapFiltered = (schedRows || []).filter((row) => includeForShiftByRole(row.role, shiftKey));

        const mapped = overlapFiltered
          .map((row) =>
            createEmployeeRow({
              employee_id: row.employee_id,
              employee_name: row.employee_name,
              role: row.role,
              scheduled_start: row.scheduled_start,
              scheduled_end: row.scheduled_end,
            })
          )
          .sort((a, b) => {
            return toMinutes(a.scheduled_start) - toMinutes(b.scheduled_start);
          });

        const latest=history.versions[0];
        const restored=(latest?.assignments || []).map(a=>createEmployeeRow({...a,unscheduled:true}));
        const unique=new Set(restored.map(a=>a.employee_id));
        for(const row of mapped) {
          if(!row.employee_id) {
            const matches=active.filter(e=>e.name.toLowerCase()===row.employee_name.trim().toLowerCase());
            if(matches.length===1) row.employee_id=matches[0].id;
          }
          if(row.employee_id && unique.has(row.employee_id)) continue;
          if(row.employee_id) unique.add(row.employee_id);
          restored.push(row);
        }
        setEmployees(restored);
        setActiveEmployees(active);
        setVersions(history.versions);
        setExistingLog(latest || null);
        setEffectiveTime("");
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
  }, [logDate, shiftKey, supabase, reload]);

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
          employee_id: selected.id,
          employee_name: selected.name,
          role: "Unscheduled",
          unscheduled: true,
        })
      )
    );
    setUnscheduledEmployeeId("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError("");
    const shiftDef = SHIFT_OPTIONS[shiftKey];
    setSubmitting(true);
    try {
      const effective=effectiveTime?fromStoreDateTimeLocal(effectiveTime):null;
      if(effectiveTime && (!effective || toStoreDateTimeLocal(effective.toISOString()).slice(0,16)!==effectiveTime)) throw new Error('Enter a valid store time.');
      if(assignedRows.some(r=>!r.employee_id)) throw new Error('Match the highlighted names to an active roster employee first.');
      const body={date:logDate,shift:shiftDef.label,effective_at:effective?.toISOString()||null,base:existingLog?.id||null,
        assignments:assignedRows.map(r=>({employee_id:r.employee_id,stations:r.stations,notes:r.notes||''}))};
      const signature=JSON.stringify(body);
      if(saveAttempt.current?.signature!==signature) saveAttempt.current={id:crypto.randomUUID(),signature};
      const response=await fetch('/api/deployment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,id:saveAttempt.current.id})});
      const json=await response.json(); if(!response.ok) throw new Error(json.error);
      setSuccessState({
        logDate,
        shift: shiftDef.label,
        submittedBy:json.version.submitted_by,
        effectiveAt:json.version.effective_at,
        assignedCount:assignedRows.length,
        coverage,
      });
    } catch (err) {
      setSubmitError(err?.message || "Deployment submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function submitAnother() {
    setSuccessState(null);
    setReload(n=>n+1);
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
            <span className="font-semibold">Effective from:</span> {formatStoreDateTime(successState.effectiveAt)} (store time). Previous versions retained.
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
          {canSubmit ? (
            <button
              type="button"
              onClick={submitAnother}
              className="min-h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white hover:bg-[#ab0d26]"
            >
              Update station assignments
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const readOnly = !canSubmit;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <h2 className="text-2xl font-bold text-[#C8102E]">Deployment Chart</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fmtLongDate(today)}</p>
      </header>

      {readOnly ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          View only — shift lead or GM access is required to submit deployments.
        </p>
      ) : null}

      <form onSubmit={readOnly ? (e) => e.preventDefault() : handleSubmit} className="space-y-4">
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-4">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Date
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                readOnly={readOnly}
                disabled={readOnly}
                className="mt-1 h-11 w-full rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950 disabled:opacity-70"
              />
            </label>

            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Shift</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {["MORNING", "NIGHT"].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => !readOnly && setShiftKey(key)}
                    disabled={readOnly}
                    className={`min-h-11 rounded-lg border text-sm font-bold disabled:cursor-not-allowed disabled:opacity-70 ${
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
              <input value={submittedBy} readOnly className="mt-1 h-11 w-full rounded-lg border px-3 text-sm" />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium">Assignments effective from (Mountain time)
            <input type="datetime-local" value={effectiveTime} onChange={e=>setEffectiveTime(e.target.value)} disabled={readOnly}
              className="mt-1 block rounded-lg border p-2 dark:bg-zinc-950" />
          </label>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Leave blank for now. Save everyone currently working, then update whenever someone moves or leaves. A new save replaces current coverage from that time onward; earlier versions remain. Clear all stations and save to end coverage.</p>
        </article>

        {existingLog ? (
          <article className="rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            <p className="font-semibold">Latest saved coverage for this day</p>
            <p className="mt-1">
              Submitted by {existingLog.submitted_by}; effective {formatStoreDateTime(existingLog.effective_at)}.
            </p>
            <p className="mt-1">Save a new version when staffing changes. Reload if another manager has updated it.</p>
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
                No schedule found for this date and shift. A manager can add shifts in Schedule Builder.
              </p>
              {canSubmit && <Link href="/schedule/builder" className="mt-2 inline-block text-sm font-semibold text-[#C8102E] underline">
                Open Schedule Builder
              </Link>}
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
                    {!row.employee_id && <label className="mt-2 block text-sm text-amber-700">Match this name to the active roster
                      <select value="" disabled={readOnly} onChange={e=>{
                        const chosen=activeEmployees.find(a=>a.id===e.target.value);
                        if(chosen) setEmployees(prev=>prev.map(r=>r.id===row.id?{...r,employee_id:chosen.id,employee_name:chosen.name}:r));
                      }} className="ml-2 rounded border p-2"><option value="">Choose employee…</option>{activeEmployees.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    </label>}
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
                            onChange={() => !readOnly && toggleStation(row.id, station)}
                            disabled={readOnly}
                            className="mr-2 h-4 w-4 accent-[#C8102E] disabled:cursor-not-allowed"
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
                    readOnly={readOnly}
                    disabled={readOnly}
                    placeholder="Notes (optional)"
                    maxLength={500}
                    className="mt-3 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </div>
              ))}
            </div>
          )}

          {!readOnly ? (
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
          ) : null}
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

        {canSubmit ? (
        <button
          type="submit"
          disabled={submitting || loadingSchedule || Boolean(fetchError)}
          className="min-h-12 w-full rounded-xl bg-[#C8102E] px-4 text-base font-bold text-white shadow-sm hover:bg-[#ab0d26] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
        ) : null}
      </form>
      {versions.length>0 && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Deployment timeline · {versions.length} versions</summary>
        {versions.map(v=><div key={v.id} className="mt-3 border-t pt-3 text-sm"><p className="font-semibold">{formatStoreDateTime(v.effective_at)} · {v.submitted_by}</p>
          <p>Recorded {formatStoreDateTime(v.recorded_at)}</p>
          {v.assignments.length?v.assignments.map(a=><p key={a.employee_id}>{a.employee_name}: {a.stations.join(', ')}</p>):<p>All stations unassigned</p>}
        </div>)}
      </details>}
    </section>
  );
}
