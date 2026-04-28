"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const RED = "#C8102E";
const YELLOW = "#E8A020";
const BLUE = "#3B82F6";
const PURPLE = "#8B5CF6";
const DARK = "#1a1a1a";
const GREEN = "#2a7a3b";

const TABS = ["WEEK VIEW", "COMPARISONS", "EMPLOYEES"];

function toDateStr(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateValue, days) {
  const d = new Date(dateValue);
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekStartSunday(dateValue = new Date()) {
  const d = new Date(`${toDateStr(dateValue)}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function parseNameParts(name) {
  const full = String(name || "").trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    full,
    first: parts[0] || "",
    last: parts[parts.length - 1] || "",
  };
}

function parseTimeStringToMinutes(timeText) {
  const value = String(timeText || "").trim();
  const m = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseIsoDateTimeToMinutes(isoText) {
  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function fmtDateShort(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateLong(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtHours(n) {
  return `${(Number(n) || 0).toFixed(1)}h`;
}

function fmtTime(t) {
  const mins = parseTimeStringToMinutes(t);
  if (!Number.isFinite(mins)) return "—";
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

function roleColor(roleText) {
  const role = String(roleText || "").toLowerCase();
  if (role.includes("breakfast") || role.includes("open")) return YELLOW;
  if (role.includes("morning") || role.includes("day lead")) return BLUE;
  if (role.includes("mid")) return PURPLE;
  if (role.includes("night lead") || role === "night" || role.includes("night ")) return RED;
  if (role.includes("closing") || role.includes("close")) return DARK;
  return "#6b7280";
}

function deriveStatus(diffIn, diffOut, hasLabor, isFuture) {
  if (isFuture) return { label: "PENDING", color: "text-zinc-500", severity: "gray" };
  if (!hasLabor) return { label: "NO SHOW", color: "text-red-700", severity: "red" };
  const lateIn = Number.isFinite(diffIn) ? diffIn > 10 : false;
  const earlyOut = Number.isFinite(diffOut) ? diffOut < -10 : false;
  if (lateIn && earlyOut) return { label: "LATE IN + EARLY OUT", color: "text-red-700", severity: "red" };
  if (lateIn) return { label: "LATE IN", color: "text-red-700", severity: "red" };
  if (earlyOut) return { label: "EARLY OUT", color: "text-amber-700", severity: "yellow" };
  return { label: "ON TIME", color: "text-green-700", severity: "green" };
}

function badgeClass(kind, minutes = 0) {
  const absMin = Math.abs(minutes);
  if (kind === "LATE IN") return absMin >= 20 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800";
  if (kind === "EARLY OUT") return absMin >= 20 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800";
  if (kind === "EARLY IN") return "bg-blue-100 text-blue-700";
  if (kind === "LATE OUT") return "bg-zinc-200 text-zinc-700";
  if (kind === "NO SHOW") return "bg-red-100 text-red-700";
  if (kind === "LONG SHIFT") return "bg-yellow-100 text-yellow-800";
  return "bg-zinc-100 text-zinc-700";
}

function dotColorForComparison(cmp) {
  if (cmp.isFuture) return "bg-zinc-400";
  if (!cmp.hasLabor) return "bg-red-600";
  const highSeverity = cmp.flags.some((f) => ["LATE IN", "EARLY OUT", "NO SHOW"].includes(f.type) && Math.abs(f.minutes || 0) >= 20);
  if (highSeverity) return "bg-red-600";
  const mediumSeverity = cmp.flags.some((f) => ["LATE IN", "EARLY OUT"].includes(f.type));
  if (mediumSeverity) return "bg-amber-500";
  return "bg-green-600";
}

function getLaborMatchForShift(shift, laborByDate) {
  const dateKey = shift.shift_date;
  const laborRows = laborByDate.get(dateKey) || [];
  if (!laborRows.length) return null;
  const shiftLastName = parseNameParts(shift.employee_name).last.toLowerCase();
  const schedStartMin = parseTimeStringToMinutes(shift.scheduled_start);
  if (!shiftLastName || !Number.isFinite(schedStartMin)) return null;
  const candidates = laborRows.filter((row) => {
    const laborLast = parseNameParts(row.employee_name).last.toLowerCase();
    if (!laborLast) return false;
    return laborLast.includes(shiftLastName) || shiftLastName.includes(laborLast);
  });
  if (!candidates.length) return null;
  let best = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const row of candidates) {
    const actualInMin = parseIsoDateTimeToMinutes(row.clock_in);
    if (!Number.isFinite(actualInMin)) continue;
    const gap = Math.abs(actualInMin - schedStartMin);
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }
  return best;
}

function buildComparison(shift, laborRow, todayStr) {
  const schedInMin = parseTimeStringToMinutes(shift.scheduled_start);
  const schedOutMin = parseTimeStringToMinutes(shift.scheduled_end);
  const actualInMin = laborRow ? parseIsoDateTimeToMinutes(laborRow.clock_in) : null;
  const actualOutMin = laborRow ? parseIsoDateTimeToMinutes(laborRow.clock_out) : null;
  const isFuture = shift.shift_date > todayStr;
  const hasLabor = Boolean(laborRow);
  const flags = [];
  const diffIn = Number.isFinite(actualInMin) && Number.isFinite(schedInMin) ? actualInMin - schedInMin : null;
  const diffOut = Number.isFinite(actualOutMin) && Number.isFinite(schedOutMin) ? actualOutMin - schedOutMin : null;
  if (hasLabor) {
    if (Number.isFinite(diffIn) && diffIn > 10) flags.push({ type: "LATE IN", minutes: diffIn });
    if (Number.isFinite(diffIn) && diffIn < -10) flags.push({ type: "EARLY IN", minutes: diffIn });
    if (Number.isFinite(diffOut) && diffOut < -10) flags.push({ type: "EARLY OUT", minutes: diffOut });
    if (Number.isFinite(diffOut) && diffOut > 10) flags.push({ type: "LATE OUT", minutes: diffOut });
  } else if (!isFuture) {
    flags.push({ type: "NO SHOW", minutes: null });
  }
  const actualHours = Number(laborRow?.total_hours ?? laborRow?.hours ?? 0) || 0;
  const scheduledHours = Number(shift.scheduled_hours) || 0;
  if (hasLabor && actualHours > scheduledHours + 1) flags.push({ type: "LONG SHIFT", minutes: null });
  const status = deriveStatus(diffIn, diffOut, hasLabor, isFuture);
  return {
    shift,
    laborRow,
    hasLabor,
    isFuture,
    schedInMin,
    schedOutMin,
    actualInMin,
    actualOutMin,
    diffIn,
    diffOut,
    actualHours,
    scheduledHours,
    flags,
    status,
  };
}

function dayNameFromDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
}

export default function SchedulePage() {
  const [tab, setTab] = useState("WEEK VIEW");
  const [weekStart, setWeekStart] = useState(() => toDateStr(getWeekStartSunday()));
  const [rangeStart, setRangeStart] = useState(() => toDateStr(getWeekStartSunday()));
  const [rangeEnd, setRangeEnd] = useState(() => toDateStr(addDays(getWeekStartSunday(), 6)));
  const [loading, setLoading] = useState(true);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [laborRows, setLaborRows] = useState([]);
  const [dayOpen, setDayOpen] = useState({});
  const [employeeOpen, setEmployeeOpen] = useState({});
  const todayStr = toDateStr(new Date());

  const weekEnd = useMemo(() => toDateStr(addDays(new Date(`${weekStart}T00:00:00`), 6)), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const supabase = getSupabase();
        const globalStart = toDateStr(addDays(new Date(`${rangeStart}T00:00:00`), -30));
        const globalEnd = rangeEnd > weekEnd ? rangeEnd : weekEnd;
        const [{ data: sData, error: sErr }, { data: lData, error: lErr }] = await Promise.all([
          supabase.from("schedule_shifts").select("*").gte("shift_date", globalStart).lte("shift_date", globalEnd),
          supabase.from("labor_logs").select("*").gte("log_date", globalStart).lte("log_date", globalEnd),
        ]);
        if (sErr) throw sErr;
        if (lErr) throw lErr;
        if (!cancelled) {
          setScheduleRows(sData || []);
          setLaborRows((lData || []).filter((r) => Number(r?.total_hours ?? r?.hours ?? 0) <= 16));
        }
      } catch {
        if (!cancelled) {
          setScheduleRows([]);
          setLaborRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [weekEnd, weekStart, rangeStart, rangeEnd]);

  const laborByDate = useMemo(() => {
    const map = new Map();
    for (const row of laborRows) {
      const key = row.log_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [laborRows]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateStr(addDays(new Date(`${weekStart}T00:00:00`), i))), [weekStart]);

  const weekComparisonsByDay = useMemo(() => {
    const rows = scheduleRows.filter((r) => r.shift_date >= weekStart && r.shift_date <= weekEnd);
    const byDay = new Map(weekDays.map((d) => [d, []]));
    for (const shift of rows) {
      const laborMatch = getLaborMatchForShift(shift, laborByDate);
      const cmp = buildComparison(shift, laborMatch, todayStr);
      byDay.get(shift.shift_date)?.push(cmp);
    }
    for (const day of weekDays) {
      byDay.get(day)?.sort((a, b) => (a.schedInMin ?? 0) - (b.schedInMin ?? 0));
    }
    return byDay;
  }, [scheduleRows, weekStart, weekEnd, weekDays, laborByDate, todayStr]);

  const weekSummary = useMemo(() => {
    const all = weekDays.flatMap((d) => weekComparisonsByDay.get(d) || []);
    return {
      totalShifts: all.length,
      totalHours: all.reduce((s, c) => s + c.scheduledHours, 0),
      employees: new Set(all.map((c) => c.shift.employee_name.toLowerCase())).size,
      daysWithData: weekDays.filter((d) => (weekComparisonsByDay.get(d) || []).length > 0).length,
    };
  }, [weekDays, weekComparisonsByDay]);

  const hasWeekSchedule = weekSummary.totalShifts > 0;
  const hasWeekLabor = weekDays.some((d) => (weekComparisonsByDay.get(d) || []).some((x) => x.hasLabor));

  const comparisonDays = useMemo(() => {
    const dates = [];
    let cur = new Date(`${rangeStart}T00:00:00`);
    const end = new Date(`${rangeEnd}T00:00:00`);
    while (cur <= end) {
      dates.push(toDateStr(cur));
      cur = addDays(cur, 1);
    }
    return dates;
  }, [rangeStart, rangeEnd]);

  const comparisonsByDay = useMemo(() => {
    const out = new Map();
    for (const day of comparisonDays) out.set(day, []);
    const schedInRange = scheduleRows.filter((r) => r.shift_date >= rangeStart && r.shift_date <= rangeEnd);
    for (const shift of schedInRange) {
      const laborMatch = getLaborMatchForShift(shift, laborByDate);
      out.get(shift.shift_date)?.push(buildComparison(shift, laborMatch, todayStr));
    }
    for (const day of comparisonDays) {
      const list = out.get(day) || [];
      const dayLabor = laborByDate.get(day) || [];
      const usedIds = new Set(list.map((x) => x.laborRow?.id).filter(Boolean));
      for (const labor of dayLabor) {
        if (usedIds.has(labor.id)) continue;
        list.push({
          shift: null,
          laborRow: labor,
          hasLabor: true,
          isFuture: false,
          schedInMin: null,
          schedOutMin: null,
          actualInMin: parseIsoDateTimeToMinutes(labor.clock_in),
          actualOutMin: parseIsoDateTimeToMinutes(labor.clock_out),
          diffIn: null,
          diffOut: null,
          actualHours: Number(labor.total_hours ?? labor.hours ?? 0) || 0,
          scheduledHours: 0,
          flags: [],
          status: { label: "UNSCHEDULED", color: "text-purple-700", severity: "purple" },
        });
      }
      list.sort((a, b) => (a.schedInMin ?? a.actualInMin ?? 0) - (b.schedInMin ?? b.actualInMin ?? 0));
      out.set(day, list);
    }
    return out;
  }, [scheduleRows, laborByDate, comparisonDays, rangeStart, rangeEnd, todayStr]);

  const employeeCards = useMemo(() => {
    const start = toDateStr(addDays(new Date(), -30));
    const shifts = scheduleRows.filter((s) => s.shift_date >= start);
    const byEmployee = new Map();
    for (const shift of shifts) {
      const key = shift.employee_name.toLowerCase();
      if (!byEmployee.has(key)) byEmployee.set(key, { name: shift.employee_name, shifts: [] });
      const cmp = buildComparison(shift, getLaborMatchForShift(shift, laborByDate), todayStr);
      byEmployee.get(key).shifts.push(cmp);
    }
    const cards = [...byEmployee.values()].map((group) => {
      const sorted = [...group.shifts].sort((a, b) => b.shift.shift_date.localeCompare(a.shift.shift_date));
      const total = sorted.length;
      const onTime = sorted.filter((s) => s.status.label === "ON TIME").length;
      const lateIn = sorted.filter((s) => s.flags.some((f) => f.type === "LATE IN")).length;
      const earlyOut = sorted.filter((s) => s.flags.some((f) => f.type === "EARLY OUT")).length;
      const noShow = sorted.filter((s) => s.flags.some((f) => f.type === "NO SHOW")).length;
      const totalFlags = sorted.reduce((n, s) => n + s.flags.length, 0);
      const avgLate =
        lateIn > 0
          ? sorted
              .flatMap((s) => s.flags.filter((f) => f.type === "LATE IN").map((f) => f.minutes))
              .reduce((a, b) => a + Math.abs(b), 0) / lateIn
          : 0;
      const avgEarly =
        earlyOut > 0
          ? sorted
              .flatMap((s) => s.flags.filter((f) => f.type === "EARLY OUT").map((f) => f.minutes))
              .reduce((a, b) => a + Math.abs(b), 0) / earlyOut
          : 0;
      const roles = [...new Set(sorted.map((s) => s.shift.role).filter(Boolean))];
      const score = total ? (onTime / total) * 100 : 0;

      const patterns = [];
      const lateByDay = new Map();
      for (const s of sorted) {
        if (s.flags.some((f) => f.type === "LATE IN")) {
          const day = dayNameFromDate(s.shift.shift_date);
          lateByDay.set(day, (lateByDay.get(day) || 0) + 1);
        }
      }
      for (const [day, count] of lateByDay.entries()) {
        if (count >= 3) patterns.push(`Frequently late on ${day}`);
      }
      const earlyByRole = new Map();
      for (const s of sorted) {
        if (s.flags.some((f) => f.type === "EARLY OUT")) {
          const role = s.shift.role || "Unknown";
          earlyByRole.set(role, (earlyByRole.get(role) || 0) + 1);
        }
      }
      for (const [role, count] of earlyByRole.entries()) {
        if (count >= 3) patterns.push(`Frequently leaves early on ${role}`);
      }
      const reliableOpenCount = sorted.filter((s) => {
        const role = String(s.shift.role || "").toLowerCase();
        return (role.includes("morning") || role.includes("open")) && s.status.label === "ON TIME";
      }).length;
      if (reliableOpenCount >= 5) patterns.push("Reliable opener");
      if (totalFlags === 0 && total > 0) patterns.push("Perfect attendance");

      return {
        key: group.name.toLowerCase(),
        name: group.name,
        roles,
        score,
        onTime,
        total,
        lateIn,
        earlyOut,
        noShow,
        totalFlags,
        avgLate,
        avgEarly,
        timeline: sorted.slice(0, 5).reverse(),
        history: sorted,
        patterns,
      };
    });
    return cards.sort((a, b) => b.totalFlags - a.totalFlags || a.name.localeCompare(b.name));
  }, [scheduleRows, laborByDate, todayStr]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5">
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`rounded-lg py-2 text-sm font-bold ${tab === name ? "bg-[#C8102E] text-white" : "text-zinc-700 dark:text-zinc-300"}`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "WEEK VIEW" ? (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setWeekStart(toDateStr(addDays(new Date(`${weekStart}T00:00:00`), -7)))} className="rounded-md border border-zinc-300 px-2 py-1 text-sm">
                ←
              </button>
              <p className="text-sm font-bold text-[#C8102E]">
                Week of {fmtDateLong(weekStart)} - {fmtDateLong(weekEnd)}
              </p>
              <button type="button" onClick={() => setWeekStart(toDateStr(addDays(new Date(`${weekStart}T00:00:00`), 7)))} className="rounded-md border border-zinc-300 px-2 py-1 text-sm">
                →
              </button>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">Scheduled shifts</p><p className="font-bold">{weekSummary.totalShifts}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">Scheduled hours</p><p className="font-bold">{fmtHours(weekSummary.totalHours)}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">Employees</p><p className="font-bold">{weekSummary.employees}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">Days with data</p><p className="font-bold">{weekSummary.daysWithData}</p>
            </div>
          </section>

          {loading ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">Loading week...</div>
          ) : !hasWeekSchedule ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="font-semibold text-zinc-800 dark:text-zinc-200">No schedule uploaded for this week</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Upload a Jolt schedule CSV on the Import page{" "}
                <Link href="/import" className="text-[#C8102E] underline">/import</Link>
              </p>
            </div>
          ) : (
            <>
              {!hasWeekLabor ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  Labor data not yet available for this period. Import a labor CSV to see attendance comparisons.
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="grid min-w-[840px] grid-cols-7 gap-2">
                  {weekDays.map((d) => (
                    <div key={d} className="min-w-[120px] rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                      <p className="text-xs font-bold">{new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</p>
                      <p className="mb-2 text-xs text-zinc-500">{fmtDateShort(d)}</p>
                      <div className="space-y-2">
                        {(weekComparisonsByDay.get(d) || []).map((cmp, idx) => (
                          <div key={`${d}-${idx}`} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700">
                            <div className="flex items-center justify-between">
                              <p className="font-semibold">{parseNameParts(cmp.shift.employee_name).first || cmp.shift.employee_name}</p>
                              <span className={`h-2 w-2 rounded-full ${dotColorForComparison(cmp)}`} />
                            </div>
                            <p className="mt-1 rounded px-1 py-0.5 text-[10px] text-white" style={{ background: roleColor(cmp.shift.role) }}>
                              {cmp.shift.role || "Role"}
                            </p>
                            <p className="mt-1 text-zinc-600 dark:text-zinc-300">{fmtTime(cmp.shift.scheduled_start)} → {fmtTime(cmp.shift.scheduled_end)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      ) : null}

      {tab === "COMPARISONS" ? (
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-600">Start
              <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
            </label>
            <label className="text-xs text-zinc-600">End
              <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
            </label>
          </div>

          {comparisonDays.map((day) => {
            const rows = comparisonsByDay.get(day) || [];
            const flagCount = rows.reduce((n, r) => n + r.flags.length, 0);
            const open = Boolean(dayOpen[day]);
            const dailyScheduled = rows.filter((r) => r.shift);
            const dailySummary = {
              sched: dailyScheduled.reduce((s, r) => s + r.scheduledHours, 0),
              actual: dailyScheduled.reduce((s, r) => s + r.actualHours, 0),
            };
            return (
              <section key={day} className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <button type="button" onClick={() => setDayOpen((s) => ({ ...s, [day]: !open }))} className="flex w-full items-center justify-between p-3 text-left">
                  <p className="text-sm font-semibold">{fmtDateLong(day)} | {dailyScheduled.length} shifts scheduled | {flagCount} flags</p>
                  <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
                </button>
                {open ? (
                  <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
                    <div className="overflow-x-auto">
                      <table className="min-w-[980px] text-left text-xs">
                        <thead className="bg-zinc-50 dark:bg-zinc-800">
                          <tr>
                            <th className="px-2 py-1">Employee</th><th className="px-2 py-1">Role</th><th className="px-2 py-1">Sched In</th>
                            <th className="px-2 py-1">Actual In</th><th className="px-2 py-1">Sched Out</th><th className="px-2 py-1">Actual Out</th>
                            <th className="px-2 py-1">Sched Hrs</th><th className="px-2 py-1">Actual Hrs</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Flags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, idx) => (
                            <tr key={`${day}-${idx}`} className={`border-t border-zinc-100 dark:border-zinc-800 ${r.status.label === "NO SHOW" ? "bg-red-50/70" : ""}`}>
                              <td className="px-2 py-1">{r.shift?.employee_name || r.laborRow?.employee_name || "—"}</td>
                              <td className="px-2 py-1">{r.shift?.role || "—"}</td>
                              <td className="px-2 py-1">{r.shift ? fmtTime(r.shift.scheduled_start) : "—"}</td>
                              <td className="px-2 py-1">{r.hasLabor ? fmtTime(`${String(Math.floor((r.actualInMin ?? 0) / 60)).padStart(2, "0")}:${String((r.actualInMin ?? 0) % 60).padStart(2, "0")}:00`) : "—"}</td>
                              <td className="px-2 py-1">{r.shift ? fmtTime(r.shift.scheduled_end) : "—"}</td>
                              <td className="px-2 py-1">{r.hasLabor ? fmtTime(`${String(Math.floor((r.actualOutMin ?? 0) / 60)).padStart(2, "0")}:${String((r.actualOutMin ?? 0) % 60).padStart(2, "0")}:00`) : "—"}</td>
                              <td className="px-2 py-1">{fmtHours(r.scheduledHours)}</td>
                              <td className="px-2 py-1">{fmtHours(r.actualHours)}</td>
                              <td className={`px-2 py-1 font-semibold ${r.status.color}`}>{r.status.label}</td>
                              <td className="px-2 py-1">
                                <div className="flex flex-wrap gap-1">
                                  {r.flags.map((f, i2) => (
                                    <span key={`${idx}-${i2}`} className={`rounded px-1 py-0.5 text-[10px] font-semibold ${badgeClass(f.type, f.minutes)}`}>
                                      {f.type}
                                      {Number.isFinite(f.minutes) ? ` (${f.minutes > 0 ? "+" : ""}${Math.round(f.minutes)} min)` : ""}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
                      Total scheduled hours: {fmtHours(dailySummary.sched)} | Total actual hours: {fmtHours(dailySummary.actual)} | Variance: {fmtHours(dailySummary.actual - dailySummary.sched)} | Flags: {flagCount}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </section>
      ) : null}

      {tab === "EMPLOYEES" ? (
        <section className="space-y-3">
          {employeeCards.map((emp) => {
            const open = Boolean(employeeOpen[emp.key]);
            const scoreColor = emp.score >= 95 ? "text-green-700" : emp.score >= 80 ? "text-amber-700" : "text-red-700";
            return (
              <article key={emp.key} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <button type="button" onClick={() => setEmployeeOpen((s) => ({ ...s, [emp.key]: !open }))} className="flex w-full items-center justify-between text-left">
                  <div>
                    <p className="font-bold">{emp.name}</p>
                    <p className="text-xs text-zinc-500">{emp.roles.join(" · ") || "No role data"}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${scoreColor}`}>Attendance {emp.score.toFixed(1)}%</p>
                    <p className="text-xs text-zinc-500">{emp.onTime}/{emp.total} on time</p>
                  </div>
                </button>
                <div className="mt-3 text-xs text-zinc-700 dark:text-zinc-300">
                  On Time: {emp.onTime} | Late In: {emp.lateIn} | Early Out: {emp.earlyOut} | No Show: {emp.noShow}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Avg late arrival: {emp.lateIn ? `${Math.round(emp.avgLate)} min` : "—"} | Avg early departure: {emp.earlyOut ? `${Math.round(emp.avgEarly)} min` : "—"}
                </div>
                <div className="mt-2 flex gap-1">
                  {emp.timeline.map((s, idx) => (
                    <span key={idx} title={`${s.shift.shift_date} - ${s.status.label}`} className={`h-3 w-3 rounded-full ${dotColorForComparison(s)}`} />
                  ))}
                </div>
                {emp.patterns.length > 0 ? (
                  <div className="mt-2 rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
                    <p className="font-semibold text-[#C8102E]">Patterns</p>
                    {emp.patterns.map((p) => (
                      <p key={p}>- {p}</p>
                    ))}
                  </div>
                ) : null}
                {open ? (
                  <div className="mt-3 overflow-x-auto border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <table className="min-w-[760px] text-left text-xs">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr><th className="px-2 py-1">Date</th><th className="px-2 py-1">Role</th><th className="px-2 py-1">Sched</th><th className="px-2 py-1">Actual</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Flags</th></tr>
                      </thead>
                      <tbody>
                        {emp.history.map((s, idx) => (
                          <tr key={idx} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-2 py-1">{s.shift.shift_date}</td>
                            <td className="px-2 py-1">{s.shift.role || "—"}</td>
                            <td className="px-2 py-1">{fmtTime(s.shift.scheduled_start)} - {fmtTime(s.shift.scheduled_end)}</td>
                            <td className="px-2 py-1">{s.hasLabor ? `${fmtHours(s.actualHours)}` : "—"}</td>
                            <td className={`px-2 py-1 font-semibold ${s.status.color}`}>{s.status.label}</td>
                            <td className="px-2 py-1">{s.flags.map((f) => f.type).join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
