"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScheduleSubnav from "@/components/schedule/ScheduleSubnav";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import ShiftEditModal from "@/components/schedule/ShiftEditModal";
import { employeeFullName, fetchEmployees, matchesEmployeeByName } from "@/lib/employees";
import {
  compareEmployees,
  computeScheduledHours,
  contrastText,
  DAY_LABELS,
  defaultShiftForRole,
  downloadCsv,
  formatClock,
  formatHours,
  formatShortDate,
  formatWeekRange,
  nameKey,
  SCHEDULE_STORE_ID,
  SHIFT_PALETTE,
  SHIFT_SOURCE_HUB,
  shiftPayload,
  shiftWarningMessages,
  shiftsToCsv,
  weekDates,
  weekEndSaturday,
  weekStartSunday,
} from "@/lib/schedule";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getSupabase } from "@/lib/supabase";

function findEmployeeForShift(shift, employees) {
  if (shift.jolt_employee_id) {
    const byJolt = employees.find(
      (emp) =>
        emp.jolt_employee_id &&
        String(emp.jolt_employee_id) === String(shift.jolt_employee_id)
    );
    if (byJolt) return byJolt;
  }
  return employees.find((emp) => matchesEmployeeByName(shift.employee_name, emp)) || null;
}

function stationColor(stations, stationName) {
  const match = stations.find((s) => s.name === stationName);
  return match?.color || "#6b7280";
}

function rowKey(emp) {
  return emp.isSynthetic ? `name:${nameKey(emp.fullName)}` : emp.id;
}

export default function ScheduleBuilder() {
  const supabase = useMemo(() => getSupabase(), []);
  const [weekStart, setWeekStart] = useState(() => weekStartSunday(getStoreToday()));
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [stations, setStations] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [weekRecord, setWeekRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessionEmployee, setSessionEmployee] = useState(null);
  const [editingShift, setEditingShift] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [showTimeOff, setShowTimeOff] = useState(false);

  const shiftsRef = useRef(shifts);
  const dragRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    shiftsRef.current = shifts;
  }, [shifts]);

  const showToast = useCallback((message, type = "error") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekEnd = dates[6];
  const published = weekRecord?.status === "published";
  const sessionName = sessionEmployee
    ? `${sessionEmployee.first_name || ""} ${sessionEmployee.last_name || ""}`.trim()
    : "";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.employee) setSessionEmployee(json.employee);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const empSelectWithJolt =
        "id, first_name, last_name, role, is_shift_lead, primary_role, jolt_employee_id, is_active";
      let employeeRows = [];
      try {
        employeeRows = await fetchEmployees(supabase, { select: empSelectWithJolt });
      } catch {
        employeeRows = await fetchEmployees(supabase, {
          select: "id, first_name, last_name, role, is_shift_lead, primary_role, is_active",
        });
      }

      const [
        shiftsRes,
        stationsRes,
        weekRes,
        templatesRes,
        timeOffWeekRes,
        timeOffPendingRes,
      ] = await Promise.all([
        supabase
          .from("schedule_shifts")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .gte("shift_date", weekStart)
          .lte("shift_date", weekEnd),
        supabase
          .from("stations")
          .select("id, name, color, sort_order, is_active, store_id")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabase
          .from("schedule_weeks")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .eq("week_start_date", weekStart)
          .maybeSingle(),
        supabase
          .from("schedule_templates")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .order("created_at", { ascending: false }),
        supabase
          .from("time_off_requests")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .lte("start_date", weekEnd)
          .gte("end_date", weekStart),
        supabase
          .from("time_off_requests")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .eq("status", "pending"),
      ]);

      if (shiftsRes.error) throw shiftsRes.error;
      if (stationsRes.error) throw stationsRes.error;
      if (weekRes.error && weekRes.error.code !== "PGRST116") throw weekRes.error;
      if (templatesRes.error) throw templatesRes.error;
      if (timeOffWeekRes.error) throw timeOffWeekRes.error;
      if (timeOffPendingRes.error) throw timeOffPendingRes.error;

      const mappedEmployees = (employeeRows || []).map((row) => ({
        ...row,
        fullName: employeeFullName(row),
      }));
      const ids = mappedEmployees.map((e) => e.id).filter(Boolean);
      let availabilityRows = [];
      if (ids.length) {
        const availRes = await supabase
          .from("employee_availability")
          .select("*")
          .in("employee_id", ids);
        if (availRes.error) throw availRes.error;
        availabilityRows = availRes.data || [];
      }

      const stationRows = stationsRes.data || [];
      const storeStations = stationRows.filter((s) => s.store_id === SCHEDULE_STORE_ID);
      setEmployees(mappedEmployees);
      setShifts(shiftsRes.data || []);
      setStations(storeStations.length ? storeStations : stationRows);
      setWeekRecord(weekRes.data || null);
      setTemplates(templatesRes.data || []);
      const mergedTimeOff = new Map();
      for (const row of [...(timeOffWeekRes.data || []), ...(timeOffPendingRes.data || [])]) {
        mergedTimeOff.set(row.id, row);
      }
      setTimeOff([...mergedTimeOff.values()]);
      setAvailability(availabilityRows);
    } catch (err) {
      setLoadError(err?.message || "Could not load the schedule.");
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, weekStart, weekEnd]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    let cancelled = false;
    async function loadPending() {
      const { count, error } = await supabase
        .from("time_off_requests")
        .select("id", { count: "exact", head: true })
        .eq("store_id", SCHEDULE_STORE_ID)
        .eq("status", "pending");
      if (!cancelled && !error) setPendingCount(count || 0);
    }
    loadPending();
    return () => {
      cancelled = true;
    };
  }, [supabase, timeOff]);

  const rows = useMemo(() => {
    const list = [...employees];
    for (const shift of shifts) {
      const emp = findEmployeeForShift(shift, list);
      if (emp) continue;
      const already = list.some((row) => nameKey(row.fullName) === nameKey(shift.employee_name));
      if (!already && shift.employee_name) {
        list.push({
          id: `name:${nameKey(shift.employee_name)}`,
          fullName: shift.employee_name,
          first_name: shift.employee_name,
          last_name: "",
          role: "crew",
          isSynthetic: true,
          jolt_employee_id: shift.jolt_employee_id || null,
          primary_role: shift.role || "",
        });
      }
    }
    return list.sort(compareEmployees);
  }, [employees, shifts]);

  const shiftsByRowDay = useMemo(() => {
    const map = new Map();
    for (const shift of shifts) {
      const emp = findEmployeeForShift(shift, rows);
      const key = emp ? rowKey(emp) : `name:${nameKey(shift.employee_name)}`;
      const cell = `${key}|${shift.shift_date}`;
      if (!map.has(cell)) map.set(cell, []);
      map.get(cell).push(shift);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (timeToMinutesSafe(a.scheduled_start) ?? 0) -
          (timeToMinutesSafe(b.scheduled_start) ?? 0)
      );
    }
    return map;
  }, [shifts, rows]);

  const hoursByRow = useMemo(() => {
    const map = new Map();
    for (const shift of shifts) {
      const emp = findEmployeeForShift(shift, rows);
      const key = emp ? rowKey(emp) : `name:${nameKey(shift.employee_name)}`;
      map.set(key, (map.get(key) || 0) + (Number(shift.scheduled_hours) || 0));
    }
    return map;
  }, [shifts, rows]);

  const weekHours = useMemo(
    () => shifts.reduce((sum, s) => sum + (Number(s.scheduled_hours) || 0), 0),
    [shifts]
  );

  const availabilityIndex = useMemo(() => {
    const map = new Map();
    for (const row of availability) {
      map.set(`${row.employee_id}|${row.day_of_week}`, row);
      if (row.employee_name) {
        map.set(`name:${nameKey(row.employee_name)}|${row.day_of_week}`, row);
      }
    }
    return map;
  }, [availability]);

  const approvedTimeOffByName = useMemo(() => {
    const map = new Map();
    for (const req of timeOff) {
      if (req.status !== "approved") continue;
      const key = nameKey(req.employee_name);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(req);
    }
    return map;
  }, [timeOff]);

  function warningsFor(shift, emp) {
    const dow = dates.indexOf(shift.shift_date);
    const avail =
      (emp && !emp.isSynthetic && availabilityIndex.get(`${emp.id}|${dow}`)) ||
      availabilityIndex.get(`name:${nameKey(shift.employee_name)}|${dow}`) ||
      null;
    const off = approvedTimeOffByName.get(nameKey(shift.employee_name)) || [];
    return shiftWarningMessages(shift, avail, off);
  }

  async function persistInsert(local, tempId) {
    const { data, error } = await supabase
      .from("schedule_shifts")
      .insert(shiftPayload(local, weekStart))
      .select("*")
      .single();
    if (error) throw error;
    setShifts((current) =>
      current.map((row) => {
        if (row.id !== tempId) return row;
        const moved =
          row.shift_date !== local.shift_date ||
          row.employee_name !== local.employee_name ||
          row.scheduled_start !== local.scheduled_start;
        const merged = { ...data, ...row, id: data.id };
        if (moved) {
          supabase
            .from("schedule_shifts")
            .update(shiftPayload(merged, weekStart))
            .eq("id", data.id)
            .then(({ error: followErr }) => {
              if (followErr) showToast(followErr.message || "Could not save moved shift.");
            });
        }
        return merged;
      })
    );
  }

  async function addShift({ employee, date, start, end, role, station }) {
    if (published) return;
    const tempId = `temp-${crypto.randomUUID()}`;
    const local = {
      id: tempId,
      shift_date: date,
      employee_name: employee.fullName,
      jolt_employee_id: employee.jolt_employee_id || null,
      role: role || employee.primary_role || null,
      station: station || null,
      scheduled_start: start,
      scheduled_end: end,
      scheduled_hours: computeScheduledHours(start, end),
      week_start_date: weekStart,
      store_id: SCHEDULE_STORE_ID,
      notes: null,
      source: SHIFT_SOURCE_HUB,
    };
    setShifts((current) => [...current, local]);
    try {
      await persistInsert(local, tempId);
    } catch (err) {
      setShifts((current) => current.filter((row) => row.id !== tempId));
      showToast(err?.message || "Could not add shift.");
    }
  }

  async function moveShift(shiftId, employee, date) {
    if (published) return;
    const prev = shiftsRef.current.find((s) => s.id === shiftId);
    if (!prev) return;
    const patch = {
      employee_name: employee.fullName,
      jolt_employee_id: employee.jolt_employee_id || prev.jolt_employee_id || null,
      shift_date: date,
      week_start_date: weekStart,
    };
    setShifts((current) =>
      current.map((row) => (row.id === shiftId ? { ...row, ...patch } : row))
    );
    if (String(shiftId).startsWith("temp-")) return;
    const { error } = await supabase
      .from("schedule_shifts")
      .update(shiftPayload({ ...prev, ...patch }, weekStart))
      .eq("id", shiftId);
    if (error) {
      setShifts((current) =>
        current.map((row) => (row.id === shiftId ? prev : row))
      );
      showToast(error.message || "Could not move shift.");
    }
  }

  async function saveShiftEdits(shift, patch) {
    if (published) return;
    const prev = shiftsRef.current.find((s) => s.id === shift.id) || shift;
    const next = { ...prev, ...patch };
    next.scheduled_hours = computeScheduledHours(next.scheduled_start, next.scheduled_end);
    setShifts((current) => current.map((row) => (row.id === shift.id ? next : row)));
    setEditingShift(null);
    if (String(shift.id).startsWith("temp-")) return;
    const { error } = await supabase
      .from("schedule_shifts")
      .update(shiftPayload(next, weekStart))
      .eq("id", shift.id);
    if (error) {
      setShifts((current) =>
        current.map((row) => (row.id === shift.id ? prev : row))
      );
      showToast(error.message || "Could not update shift.");
    }
  }

  async function deleteShift(shift) {
    if (published) return;
    const prev = shiftsRef.current;
    setShifts((current) => current.filter((row) => row.id !== shift.id));
    setEditingShift(null);
    if (String(shift.id).startsWith("temp-")) return;
    const { error } = await supabase.from("schedule_shifts").delete().eq("id", shift.id);
    if (error) {
      setShifts(prev);
      showToast(error.message || "Could not delete shift.");
    }
  }

  async function setPublished(nextPublished) {
    const payload = {
      week_start_date: weekStart,
      store_id: SCHEDULE_STORE_ID,
      status: nextPublished ? "published" : "draft",
      published_at: nextPublished ? new Date().toISOString() : null,
      published_by: nextPublished ? sessionName || null : null,
    };
    const { data, error } = await supabase
      .from("schedule_weeks")
      .upsert(payload, { onConflict: "week_start_date,store_id" })
      .select("*")
      .single();
    if (error) {
      showToast(error.message || "Could not update publish state.");
      return;
    }
    setWeekRecord(data);
    showToast(nextPublished ? "Schedule published." : "Schedule unlocked.", "success");
  }

  async function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      showToast("Name the template before saving.");
      return;
    }
    const { data: template, error } = await supabase
      .from("schedule_templates")
      .insert({
        name,
        description: `Week of ${formatWeekRange(weekStart)}`,
        store_id: SCHEDULE_STORE_ID,
      })
      .select("*")
      .single();
    if (error) {
      showToast(error.message || "Could not save template.");
      return;
    }
    const templateShifts = shifts
      .filter((shift) => dates.includes(shift.shift_date))
      .map((shift) => ({
      template_id: template.id,
      day_of_week: dates.indexOf(shift.shift_date),
      employee_name: shift.employee_name,
      jolt_employee_id: shift.jolt_employee_id || null,
      role: shift.role || null,
      station: shift.station || null,
      scheduled_start: shift.scheduled_start,
      scheduled_end: shift.scheduled_end,
      scheduled_hours: Number(shift.scheduled_hours) || computeScheduledHours(shift.scheduled_start, shift.scheduled_end),
    }));
    if (templateShifts.length) {
      const { error: shiftErr } = await supabase
        .from("schedule_template_shifts")
        .insert(templateShifts);
      if (shiftErr) {
        showToast(shiftErr.message || "Template saved, but shifts failed.");
        return;
      }
    }
    setTemplates((current) => [template, ...current]);
    setTemplateName("");
    showToast("Template saved.", "success");
  }

  async function loadTemplate(templateId, mode) {
    if (published) return;
    const { data, error } = await supabase
      .from("schedule_template_shifts")
      .select("*")
      .eq("template_id", templateId);
    if (error) {
      showToast(error.message || "Could not load template.");
      return;
    }
    const incoming = data || [];
    if (mode === "replace" && shiftsRef.current.length) {
      const ok = window.confirm("Replace all shifts in this week with the template?");
      if (!ok) return;
      const ids = shiftsRef.current.map((s) => s.id).filter((id) => !String(id).startsWith("temp-"));
      if (ids.length) {
        const { error: delErr } = await supabase.from("schedule_shifts").delete().in("id", ids);
        if (delErr) {
          showToast(delErr.message || "Could not replace this week.");
          return;
        }
      }
    }

    const payloads = incoming
      .map((item) => {
        const date = dates[item.day_of_week];
        if (!date) return null;
        return shiftPayload(
          {
            shift_date: date,
            employee_name: item.employee_name,
            jolt_employee_id: item.jolt_employee_id || null,
            role: item.role || null,
            station: item.station || null,
            scheduled_start: item.scheduled_start,
            scheduled_end: item.scheduled_end,
            scheduled_hours: item.scheduled_hours,
            notes: null,
            source: SHIFT_SOURCE_HUB,
          },
          weekStart
        );
      })
      .filter(Boolean);

    if (payloads.length) {
      const { error: insErr } = await supabase.from("schedule_shifts").insert(payloads);
      if (insErr) {
        showToast(insErr.message || "Could not apply template shifts.");
        await loadWeek();
        return;
      }
    }
    await loadWeek();
    showToast(mode === "replace" ? "Template replaced this week." : "Template added to this week.", "success");
  }

  async function reviewTimeOff(request, status) {
    const { data, error } = await supabase
      .from("time_off_requests")
      .update({
        status,
        reviewed_by: sessionName || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .select("*")
      .single();
    if (error) {
      showToast(error.message || "Could not update request.");
      return;
    }
    setTimeOff((current) => {
      const others = current.filter((row) => row.id !== request.id);
      const overlaps = data.start_date <= weekEnd && data.end_date >= weekStart;
      return overlaps ? [...others, data] : others;
    });
    showToast(`Request ${status}.`, "success");
  }

  function onDragStartPalette(item, event) {
    dragRef.current = { kind: "palette", ...item };
    event.dataTransfer.setData("text/plain", item.label);
    event.dataTransfer.effectAllowed = "copy";
  }

  function onDragStartShift(shift, event) {
    if (published) {
      event.preventDefault();
      return;
    }
    dragRef.current = { kind: "shift", id: shift.id };
    event.dataTransfer.setData("text/plain", String(shift.id));
    event.dataTransfer.effectAllowed = "move";
  }

  function onDragOverCell(emp, date, event) {
    if (published || !dragRef.current) return;
    event.preventDefault();
    setDropTarget(`${rowKey(emp)}|${date}`);
  }

  function onDropCell(emp, date, event) {
    event.preventDefault();
    setDropTarget(null);
    const payload = dragRef.current;
    dragRef.current = null;
    if (!payload || published) return;
    if (payload.kind === "palette") {
      addShift({
        employee: emp,
        date,
        start: payload.start,
        end: payload.end,
        role: payload.role,
      });
      return;
    }
    if (payload.kind === "shift") {
      moveShift(payload.id, emp, date);
    }
  }

  function exportCsv() {
    const csv = shiftsToCsv(shifts, weekStart);
    downloadCsv(`schedule-${weekStart}.csv`, csv);
  }

  const pendingRequests = timeOff.filter((r) => r.status === "pending");
  const otherRequests = timeOff.filter((r) => r.status !== "pending");

  return (
    <section className="mx-auto flex w-full flex-1 flex-col gap-3 px-3 py-4 sm:px-4">
      <ScheduleSubnav current="builder" canBuild />

      <div className="schedule-no-print flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
          >
            ←
          </button>
          <p className="min-w-[220px] text-center text-sm font-bold text-[#C8102E]">
            {formatWeekRange(weekStart)}
          </p>
          <button
            type="button"
            onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(weekStartSunday(getStoreToday()))}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
          >
            Today
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-lg bg-zinc-100 px-2 py-1 font-semibold dark:bg-zinc-800">
            {formatHours(weekHours)} total
          </span>
          <span className="text-zinc-500">{shifts.length} shifts</span>
        </div>
      </div>

      {published ? (
        <div className="schedule-no-print rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          This week is published and locked. Unlock to edit.
          <button
            type="button"
            onClick={() => setPublished(false)}
            className="ml-3 rounded-md border border-amber-400 px-2 py-1 text-xs font-semibold"
          >
            Unlock
          </button>
        </div>
      ) : null}

      <div className="schedule-no-print flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap gap-2">
          {SHIFT_PALETTE.map((item) => (
            <div
              key={item.label}
              draggable={!published}
              onDragStart={(e) => onDragStartPalette(item, e)}
              onDragEnd={() => {
                dragRef.current = null;
                setDropTarget(null);
              }}
              className={`rounded-lg border border-[#C8102E]/30 bg-[#C8102E]/10 px-2 py-1 text-left text-xs ${
                published ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"
              }`}
              title="Drag onto a cell"
            >
              <span className="block font-semibold text-[#C8102E]">{item.label}</span>
              <span className="text-zinc-600 dark:text-zinc-400">
                {formatClock(item.start)}–{formatClock(item.end)}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-500">Drag a block onto a cell, or double-click a cell.</p>
      </div>

      <div className="schedule-no-print flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Template name"
          disabled={published}
          className="rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="button"
          disabled={published}
          onClick={saveTemplate}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-zinc-700"
        >
          Save week as template
        </button>
        <label className="text-xs text-zinc-600">
          Load
          <select
            defaultValue=""
            disabled={published}
            onChange={(e) => {
              const [id, mode] = e.target.value.split("::");
              e.target.value = "";
              if (id && mode) loadTemplate(id, mode);
            }}
            className="ml-2 rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Choose template…</option>
            {templates.map((tpl) => (
              <optgroup key={tpl.id} label={tpl.name}>
                <option value={`${tpl.id}::add`}>Add {tpl.name}</option>
                <option value={`${tpl.id}::replace`}>Replace with {tpl.name}</option>
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700"
        >
          Print
        </button>
        <button
          type="button"
          disabled={published}
          onClick={() => setPublished(true)}
          className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Publish week
        </button>
        <button
          type="button"
          onClick={() => setShowTimeOff((v) => !v)}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700"
        >
          Time off{pendingCount ? ` (${pendingCount})` : ""}
        </button>
      </div>

      {showTimeOff ? (
        <section className="schedule-no-print rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold text-[#C8102E]">Time-off requests</h2>
          {![...pendingRequests, ...otherRequests].length ? (
            <p className="mt-2 text-sm text-zinc-500">No overlapping requests this week.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {[...pendingRequests, ...otherRequests].map((req) => (
                <li
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                >
                  <div>
                    <p className="font-semibold">{req.employee_name}</p>
                    <p className="text-xs text-zinc-500">
                      {req.start_date} → {req.end_date} · {req.reason || "No reason"} · {req.status}
                    </p>
                  </div>
                  {req.status === "pending" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => reviewTimeOff(req, "approved")}
                        className="rounded-md bg-green-700 px-2 py-1 text-xs font-semibold text-white"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewTimeOff(req, "denied")}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"
                      >
                        Deny
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </p>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          Loading week…
        </div>
      ) : (
        <>
          <p className="schedule-print-title mb-2 hidden text-lg font-bold text-[#C8102E] print:block">
            Arby&apos;s Payson · {formatWeekRange(weekStart)}
          </p>
          <div className="schedule-print-grid overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="min-w-[980px] w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800">
                <th className="sticky left-0 z-10 min-w-[140px] border-b border-zinc-200 bg-zinc-50 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                  Employee
                </th>
                {dates.map((date, idx) => (
                  <th
                    key={date}
                    className="min-w-[120px] border-b border-zinc-200 px-2 py-2 dark:border-zinc-700"
                  >
                    <span className="block font-bold">{DAY_LABELS[idx]}</span>
                    <span className="font-normal text-zinc-500">{formatShortDate(date)}</span>
                  </th>
                ))}
                <th className="min-w-[72px] border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((emp) => {
                const hours = hoursByRow.get(rowKey(emp)) || 0;
                const overtime = hours > 40;
                return (
                  <tr key={rowKey(emp)} className="align-top">
                    <th className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-2 py-2 text-left font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                      <span className="block">{emp.fullName}</span>
                      <span className="text-[10px] font-normal uppercase tracking-wide text-zinc-500">
                        {emp.role === "gm"
                          ? "Manager"
                          : emp.is_shift_lead || emp.role === "shift_lead"
                            ? "Shift lead"
                            : "Crew"}
                      </span>
                    </th>
                    {dates.map((date) => {
                      const cellKey = `${rowKey(emp)}|${date}`;
                      const cellShifts = shiftsByRowDay.get(cellKey) || [];
                      const active = dropTarget === cellKey;
                      return (
                        <td
                          key={cellKey}
                          onDragEnter={(e) => onDragOverCell(emp, date, e)}
                          onDragOver={(e) => onDragOverCell(emp, date, e)}
                          onDrop={(e) => onDropCell(emp, date, e)}
                          onDoubleClick={() => {
                            if (published) return;
                            const preset = defaultShiftForRole(emp.primary_role);
                            addShift({
                              employee: emp,
                              date,
                              start: preset.start,
                              end: preset.end,
                              role: preset.role,
                            });
                          }}
                          className={`h-[76px] border-b border-r border-zinc-100 p-1 dark:border-zinc-800 ${
                            active ? "bg-[#C8102E]/10" : ""
                          }`}
                        >
                          <div className="flex min-h-[68px] flex-col gap-1">
                            {cellShifts.map((shift) => {
                              const color = stationColor(stations, shift.station);
                              const warns = warningsFor(shift, emp);
                              return (
                                <button
                                  key={shift.id}
                                  type="button"
                                  draggable={!published}
                                  onDragStart={(e) => onDragStartShift(shift, e)}
                                  onDragEnd={() => {
                                    dragRef.current = null;
                                    setDropTarget(null);
                                  }}
                                  onClick={() => {
                                    if (!published) setEditingShift(shift);
                                  }}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  className="rounded px-1.5 py-1 text-left shadow-sm"
                                  style={{
                                    background: color,
                                    color: contrastText(color),
                                  }}
                                  title={warns.join(" · ") || `${shift.role || "Shift"} ${formatClock(shift.scheduled_start)}–${formatClock(shift.scheduled_end)}`}
                                >
                                  <span className="flex items-center justify-between gap-1">
                                    <span className="truncate font-semibold">
                                      {formatClock(shift.scheduled_start)}–{formatClock(shift.scheduled_end)}
                                    </span>
                                    {warns.length ? <span aria-label={warns.join(". ")}>⚠️</span> : null}
                                  </span>
                                  <span className="block truncate text-[10px] opacity-90">
                                    {shift.station || shift.role || "Shift"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-b border-zinc-100 px-2 py-2 font-semibold dark:border-zinc-800">
                      {formatHours(hours)}
                      {overtime ? (
                        <span className="ml-1" title="Over 40 hours this week">
                          ⚠️
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {stations.length ? (
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-600">
          {stations.map((station) => (
            <span key={station.id} className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: station.color || "#6b7280" }}
              />
              {station.name}
            </span>
          ))}
        </div>
      ) : null}

      {editingShift && !published ? (
        <ShiftEditModal
          shift={editingShift}
          stations={stations}
          onClose={() => setEditingShift(null)}
          onSave={(patch) => saveShiftEdits(editingShift, patch)}
          onDelete={deleteShift}
        />
      ) : null}

      <ScheduleToast toast={toast} />
    </section>
  );
}

function timeToMinutesSafe(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}
