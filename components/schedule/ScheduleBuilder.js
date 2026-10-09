"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import ShiftModal from "@/components/schedule/ShiftModal";
import ScheduleDayView from "@/components/schedule/ScheduleDayView";
import { employeeFullName, fetchEmployees } from "@/lib/employees";
import {
  assigneeFields,
  compareEmployees,
  computeScheduledHours,
  contrastText,
  DAY_LABELS,
  downloadCsv,
  findEmployeeForShift,
  formatClock,
  formatHours,
  formatLongDate,
  formatShortDate,
  formatWeekRange,
  isUnassignedShift,
  nameKey,
  resolveEmployeeId,
  SCHEDULE_STORE_ID,
  SHIFT_SOURCE_HUB,
  shiftPayload,
  shiftWarningMessages,
  shiftsToCsv,
  UNASSIGNED_ROW_ID,
  unassignedEmployeeRow,
  unpaidBreakMinutes,
  weekDates,
  weekStartSunday,
} from "@/lib/schedule";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getSupabase } from "@/lib/supabase";

function roleColor(roles, roleName) {
  const match = roles.find((role) => nameKey(role.name) === nameKey(roleName));
  return match?.color || "#6b7280";
}

function rowKey(emp) {
  if (emp?.isUnassigned) return emp.id;
  return emp.id;
}

function timeToMinutesSafe(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

async function writeShift(supabase, method, payload, id) {
  const table = supabase.from("schedule_shifts");
  const query =
    method === "insert"
      ? table.insert(payload).select("*").single()
      : table.update(payload).eq("id", id).select("*").single();
  let { data, error } = await query;
  if (error && /unpaid_break/.test(error.message || "")) {
    const rest = { ...payload };
    delete rest.unpaid_break_minutes;
    const retry =
      method === "insert"
        ? await supabase.from("schedule_shifts").insert(rest).select("*").single()
        : await supabase.from("schedule_shifts").update(rest).eq("id", id).select("*").single();
    data = retry.data;
    error = retry.error;
  }
  return { data, error };
}

export default function ScheduleBuilder() {
  const supabase = useMemo(() => getSupabase(), []);
  const [weekStart, setWeekStart] = useState(() => weekStartSunday(getStoreToday()));
  const [selectedDay, setSelectedDay] = useState(null);
  const [daySaving, setDaySaving] = useState(false);
  const daySaveRef = useRef(false);
  const [employees, setEmployees] = useState([]);
  const [catalogRoles, setCatalogRoles] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [stations, setStations] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [weekRecord, setWeekRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessionEmployee, setSessionEmployee] = useState(null);
  const [modal, setModal] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [weekTemplateName, setWeekTemplateName] = useState("");
  const [copyDragId, setCopyDragId] = useState(null);

  const shiftsRef = useRef(shifts);
  const dragRef = useRef(null);
  const duplicateModifierRef = useRef(false);
  const skipCardClickRef = useRef(false);
  const toastTimer = useRef(null);
  const templatesRef = useRef(null);
  const loadGeneration = useRef(0);

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

  useEffect(() => {
    function onDocClick(event) {
      if (templatesRef.current && !templatesRef.current.contains(event.target)) {
        setTemplatesOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const loadWeek = useCallback(async () => {
    const generation = ++loadGeneration.current;
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

      const [shiftsRes, stationsRes, weekRes, templatesRes, timeOffRes, rolesRes] = await Promise.all([
        supabase
          .from("schedule_shifts")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .gte("shift_date", weekStart)
          .lte("shift_date", weekEnd),
        supabase
          .from("stations")
          .select("id, name, color, is_active, store_id")
          .eq("is_active", true)
          .order("name", { ascending: true }),
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
        fetch("/api/roles?assignments=1")
          .then(async (res) => {
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.ok) return { roles: [], assignments: {} };
            return json;
          })
          .catch(() => ({ roles: [], assignments: {} })),
      ]);

      if (shiftsRes.error) throw shiftsRes.error;
      if (stationsRes.error) throw stationsRes.error;
      if (weekRes.error && weekRes.error.code !== "PGRST116") throw weekRes.error;
      if (templatesRes.error) throw templatesRes.error;
      if (timeOffRes.error) throw timeOffRes.error;

      const mappedEmployees = (employeeRows || []).map((row) => ({
        ...row,
        fullName: employeeFullName(row),
        assignedRoles: rolesRes.assignments?.[row.id] || [],
        primary_role:
          (rolesRes.assignments?.[row.id] || []).find((r) => r.is_primary)?.name || row.primary_role || "",
      }));
      const ids = mappedEmployees.map((e) => e.id).filter(Boolean);
      let availabilityRows = [];
      if (ids.length) {
        const availRes = await supabase.from("employee_availability").select("*").in("employee_id", ids);
        if (availRes.error) throw availRes.error;
        availabilityRows = availRes.data || [];
      }

      const stationRows = stationsRes.data || [];
      const storeStations = stationRows.filter((s) => s.store_id === SCHEDULE_STORE_ID);
      if (generation !== loadGeneration.current) return;
      setEmployees(mappedEmployees);
      setCatalogRoles(rolesRes.roles || []);
      setShifts(shiftsRes.data || []);
      setStations(storeStations.length ? storeStations : stationRows);
      setWeekRecord(weekRes.data || null);
      setTemplates(templatesRes.data || []);
      setTimeOff(timeOffRes.data || []);
      setAvailability(availabilityRows);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setLoadError(err?.message || "Could not load the schedule.");
      setShifts([]);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [supabase, weekStart, weekEnd]);

  useEffect(() => {
    loadWeek();
    return () => { loadGeneration.current += 1; };
  }, [loadWeek]);

  const rows = useMemo(() => {
    const list = [unassignedEmployeeRow(), ...employees];
    for (const shift of shifts) {
      if (isUnassignedShift(shift)) continue;
      if (findEmployeeForShift(list, shift)) continue;
      if (shift.employee_id) {
        const already = list.some((row) => String(row.id) === String(shift.employee_id));
        if (!already) {
          list.push({
            id: shift.employee_id,
            fullName: shift.employee_name || "Former employee",
            first_name: shift.employee_name || "Former employee",
            last_name: "",
            role: "crew",
            isSynthetic: true,
            jolt_employee_id: shift.jolt_employee_id || null,
            primary_role: shift.role || "",
          });
        }
        continue;
      }
      const placeholderId = `name:${nameKey(shift.employee_name)}`;
      const already = list.some((row) => row.id === placeholderId);
      if (!already && shift.employee_name) {
        list.push({
          id: placeholderId,
          fullName: shift.employee_name,
          first_name: shift.employee_name,
          last_name: "",
          role: "crew",
          isSynthetic: true,
          jolt_employee_id: null,
          primary_role: shift.role || "",
        });
      }
    }
    return list.sort(compareEmployees);
  }, [employees, shifts]);

  const shiftsByRowDay = useMemo(() => {
    const map = new Map();
    for (const shift of shifts) {
      const emp = findEmployeeForShift(rows, shift);
      const key = emp ? rowKey(emp) : shift.employee_id || `name:${nameKey(shift.employee_name)}`;
      const cell = `${key}|${shift.shift_date}`;
      if (!map.has(cell)) map.set(cell, []);
      map.get(cell).push(shift);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => (timeToMinutesSafe(a.scheduled_start) ?? 0) - (timeToMinutesSafe(b.scheduled_start) ?? 0)
      );
    }
    return map;
  }, [shifts, rows]);

  const hoursByRow = useMemo(() => {
    const map = new Map();
    for (const shift of shifts) {
      const emp = findEmployeeForShift(rows, shift);
      const key = emp ? rowKey(emp) : shift.employee_id || `name:${nameKey(shift.employee_name)}`;
      map.set(key, (map.get(key) || 0) + (Number(shift.scheduled_hours) || 0));
    }
    return map;
  }, [shifts, rows]);

  const weekHours = useMemo(
    () => shifts.reduce((sum, s) => sum + (Number(s.scheduled_hours) || 0), 0),
    [shifts]
  );

  const distinctRoles = useMemo(() => {
    const set = new Set((catalogRoles || []).map((r) => r.name).filter(Boolean));
    for (const shift of shifts) {
      if (shift.role) set.add(shift.role);
    }
    for (const emp of employees) {
      if (emp.primary_role) set.add(emp.primary_role);
      for (const role of emp.assignedRoles || []) {
        if (role.name) set.add(role.name);
      }
    }
    return [...set];
  }, [shifts, employees, catalogRoles]);

  const scheduledRoles = useMemo(() => {
    const names = new Map();
    for (const shift of shifts) {
      const key = nameKey(shift.role);
      const role = catalogRoles.find((item) => nameKey(item.name) === key);
      names.set(key, role?.name || shift.role?.trim() || "No role");
    }
    return [...names].map(([key, name]) => ({ key, name, color: roleColor(catalogRoles, key) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [shifts, catalogRoles]);

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
      (emp && !emp.isSynthetic && !emp.isUnassigned && availabilityIndex.get(`${emp.id}|${dow}`)) ||
      availabilityIndex.get(`name:${nameKey(shift.employee_name)}|${dow}`) ||
      null;
    const off = approvedTimeOffByName.get(nameKey(shift.employee_name)) || [];
    return shiftWarningMessages(shift, avail, off);
  }

  function openCreate(employee, date, start = "") {
    if (published || daySaveRef.current) return;
    setModal({
      mode: "create",
      draft: {
        shift_date: date,
        employeeId: rowKey(employee),
        role: employee.primary_role || "",
        station: "",
        scheduled_start: start,
        scheduled_end: "",
        unpaid_break_minutes: 0,
      },
    });
  }

  function openEdit(shift) {
    if (published || daySaveRef.current) return;
    const emp = findEmployeeForShift(rows, shift);
    setModal({
      mode: "edit",
      shift,
      draft: {
        shift_date: shift.shift_date,
        employeeId: emp ? rowKey(emp) : UNASSIGNED_ROW_ID,
        role: shift.role || "",
        station: shift.station || "",
        scheduled_start: shift.scheduled_start,
        scheduled_end: shift.scheduled_end,
        unpaid_break_minutes: shift.unpaid_break_minutes || 0,
      },
    });
  }

  async function saveShiftTemplate(fields, date) {
    const autoName =
      fields.templateName ||
      `${fields.role || "Shift"} ${formatClock(fields.scheduled_start)}–${formatClock(fields.scheduled_end)}`;
    const { data: template, error } = await supabase
      .from("schedule_templates")
      .insert({
        name: autoName,
        description: "Shift template",
        store_id: SCHEDULE_STORE_ID,
      })
      .select("*")
      .single();
    if (error) {
      showToast(error.message || "Shift saved, but template failed.");
      return;
    }
    const assigned = assigneeFields(fields.employee || unassignedEmployeeRow());
    const templateShift = {
      template_id: template.id,
      day_of_week: dates.indexOf(date),
      employee_id: assigned.employee_id,
      employee_name: assigned.employee_name,
      jolt_employee_id: assigned.jolt_employee_id,
      role: fields.role || null,
      station: fields.station || null,
      scheduled_start: fields.scheduled_start,
      scheduled_end: fields.scheduled_end,
      scheduled_hours: fields.scheduled_hours,
      unpaid_break_minutes: unpaidBreakMinutes(fields.unpaid_break_minutes),
    };
    let { error: shiftErr } = await supabase.from("schedule_template_shifts").insert(templateShift);
    if (shiftErr && /unpaid_break|employee_id/.test(shiftErr.message || "")) {
      const rest = { ...templateShift };
      if (/unpaid_break/.test(shiftErr.message || "")) delete rest.unpaid_break_minutes;
      if (/employee_id/.test(shiftErr.message || "")) delete rest.employee_id;
      const retry = await supabase.from("schedule_template_shifts").insert(rest);
      shiftErr = retry.error;
    }
    if (shiftErr) {
      showToast(shiftErr.message || "Shift saved, but template shifts failed.");
      return;
    }
    setTemplates((current) => [template, ...current]);
  }

  async function persistInsert(local, tempId) {
    const { data, error } = await writeShift(supabase, "insert", shiftPayload(local, weekStart));
    if (error) throw error;
    setShifts((current) =>
      current.map((row) => {
        if (row.id !== tempId) return row;
        const moved =
          row.shift_date !== local.shift_date ||
          String(row.employee_id || "") !== String(local.employee_id || "") ||
          row.employee_name !== local.employee_name;
        const merged = { ...data, ...row, id: data.id };
        if (moved) {
          writeShift(supabase, "update", shiftPayload(merged, weekStart), data.id).then(({ error: followErr }) => {
            if (followErr) showToast(followErr.message || "Could not save moved shift.");
          });
        }
        return merged;
      })
    );
  }

  async function createFromModal(fields) {
    if (published) return;
    const employee = fields.employee || unassignedEmployeeRow();
    const date = modal.draft.shift_date;
    const tempId = `temp-${crypto.randomUUID()}`;
    const assigned = assigneeFields(employee);
    const local = {
      id: tempId,
      shift_date: date,
      ...assigned,
      role: fields.role,
      station: fields.station,
      scheduled_start: fields.scheduled_start,
      scheduled_end: fields.scheduled_end,
      unpaid_break_minutes: fields.unpaid_break_minutes,
      scheduled_hours: computeScheduledHours(
        fields.scheduled_start,
        fields.scheduled_end,
        fields.unpaid_break_minutes
      ),
      week_start_date: weekStart,
      store_id: SCHEDULE_STORE_ID,
      notes: null,
      source: SHIFT_SOURCE_HUB,
    };
    setShifts((current) => [...current, local]);
    setModal(null);
    try {
      await persistInsert(local, tempId);
      if (fields.saveAsTemplate) await saveShiftTemplate(fields, date);
    } catch (err) {
      setShifts((current) => current.filter((row) => row.id !== tempId));
      showToast(err?.message || "Could not add shift.");
    }
  }

  async function saveFromModal(fields) {
    if (published) return;
    if (modal.mode === "create") {
      await createFromModal(fields);
      return;
    }
    const prev = shiftsRef.current.find((s) => s.id === modal.shift.id) || modal.shift;
    const employee = fields.employee || unassignedEmployeeRow();
    const next = {
      ...prev,
      ...assigneeFields(employee),
      role: fields.role,
      station: fields.station,
      scheduled_start: fields.scheduled_start,
      scheduled_end: fields.scheduled_end,
      unpaid_break_minutes: fields.unpaid_break_minutes,
      scheduled_hours: computeScheduledHours(
        fields.scheduled_start,
        fields.scheduled_end,
        fields.unpaid_break_minutes
      ),
    };
    setShifts((current) => current.map((row) => (row.id === prev.id ? next : row)));
    setModal(null);
    if (String(prev.id).startsWith("temp-")) return;
    const { error } = await writeShift(supabase, "update", shiftPayload(next, weekStart), prev.id);
    if (error) {
      setShifts((current) => current.map((row) => (row.id === prev.id ? prev : row)));
      showToast(error.message || "Could not update shift.");
      return;
    }
    if (fields.saveAsTemplate) await saveShiftTemplate(fields, next.shift_date);
  }

  async function deleteShift(shift) {
    if (published) return;
    const prev = shiftsRef.current;
    setShifts((current) => current.filter((row) => row.id !== shift.id));
    setModal(null);
    if (String(shift.id).startsWith("temp-")) return;
    const { error } = await supabase.from("schedule_shifts").delete().eq("id", shift.id);
    if (error) {
      setShifts(prev);
      showToast(error.message || "Could not delete shift.");
    }
  }

  async function markCallOut(shift) {
    if (!shift?.id || String(shift.id).startsWith("temp-")) return;
    try {
      const res = await fetch("/api/attendance/call-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shift.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not mark call-out.");
      setModal(null);
      showToast("Call-out recorded.", "success");
    } catch (err) {
      showToast(err.message || "Could not mark call-out.");
    }
  }

  async function moveShift(shiftId, employee, date) {
    if (published) return;
    const prev = shiftsRef.current.find((s) => s.id === shiftId);
    if (!prev) return;
    const patch = {
      ...assigneeFields(employee),
      shift_date: date,
      week_start_date: weekStart,
    };
    setShifts((current) => current.map((row) => (row.id === shiftId ? { ...row, ...patch } : row)));
    if (String(shiftId).startsWith("temp-")) return;
    const { error } = await writeShift(supabase, "update", shiftPayload({ ...prev, ...patch }, weekStart), shiftId);
    if (error) {
      setShifts((current) => current.map((row) => (row.id === shiftId ? prev : row)));
      showToast(error.message || "Could not move shift.");
    }
  }

  async function changeDayShift(shiftId, employee, fields, duplicate = false) {
    if (published) {
      showToast("Week is locked. Unlock to edit.");
      return false;
    }
    if (daySaveRef.current) return false;
    const prev = shiftsRef.current.find((shift) => shift.id === shiftId);
    if (!prev || String(shiftId).startsWith("temp-")) return false;
    // Former, unlinked employees can retain their own shift but cannot receive
    // a new assignment. All current employee moves use the stable employee id.
    if (employee.isSynthetic && employee.id !== findEmployeeForShift(rows, prev)?.id) return false;
    const id = duplicate ? `temp-${crypto.randomUUID()}` : prev.id;
    const next = {
      ...prev,
      ...assigneeFields(employee),
      ...fields,
      id,
      scheduled_hours: computeScheduledHours(fields.scheduled_start, fields.scheduled_end, prev.unpaid_break_minutes),
      ...(duplicate ? { source: SHIFT_SOURCE_HUB } : {}),
    };
    daySaveRef.current = true;
    setDaySaving(true);
    setShifts((current) => duplicate ? [...current, next] : current.map((shift) => shift.id === id ? next : shift));
    try {
      if (duplicate) {
        await persistInsert(next, id);
      } else {
        const { data, error } = await writeShift(supabase, "update", shiftPayload(next, weekStart), id);
        if (error) throw error;
        setShifts((current) => current.map((shift) => shift.id === id ? { ...next, ...data } : shift));
      }
      return true;
    } catch (error) {
      setShifts((current) => duplicate ? current.filter((shift) => shift.id !== id) : current.map((shift) => shift.id === id ? prev : shift));
      showToast(error?.message || "Could not save the shift. Your change was restored.");
      return false;
    } finally {
      daySaveRef.current = false;
      setDaySaving(false);
    }
  }

  function navigateSchedule(direction) {
    if (selectedDay) {
      const next = addDaysISO(selectedDay, direction);
      setSelectedDay(next);
      setWeekStart(weekStartSunday(next));
    } else {
      setWeekStart(addDaysISO(weekStart, direction * 7));
    }
  }

  async function duplicateShift(shiftId, employee, date) {
    if (published) {
      showToast("Week is locked. Unlock to edit.");
      return;
    }
    const prev = shiftsRef.current.find((s) => s.id === shiftId);
    if (!prev) return;
    const tempId = `temp-${crypto.randomUUID()}`;
    const breakMin = unpaidBreakMinutes(prev.unpaid_break_minutes);
    const local = {
      id: tempId,
      shift_date: date,
      ...assigneeFields(employee),
      role: prev.role || null,
      station: prev.station || null,
      scheduled_start: prev.scheduled_start,
      scheduled_end: prev.scheduled_end,
      unpaid_break_minutes: breakMin,
      scheduled_hours: computeScheduledHours(prev.scheduled_start, prev.scheduled_end, breakMin),
      week_start_date: weekStart,
      store_id: SCHEDULE_STORE_ID,
      notes: prev.notes || null,
      source: SHIFT_SOURCE_HUB,
    };
    setShifts((current) => [...current, local]);
    try {
      await persistInsert(local, tempId);
    } catch (err) {
      setShifts((current) => current.filter((row) => row.id !== tempId));
      showToast(err?.message || "Could not duplicate shift.");
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

  async function saveWeekTemplate() {
    const name = weekTemplateName.trim();
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
        employee_id: shift.employee_id || resolveEmployeeId(employees, shift),
        employee_name: shift.employee_name,
        jolt_employee_id: shift.jolt_employee_id || null,
        role: shift.role || null,
        station: shift.station || null,
        scheduled_start: shift.scheduled_start,
        scheduled_end: shift.scheduled_end,
        scheduled_hours:
          Number(shift.scheduled_hours) ||
          computeScheduledHours(shift.scheduled_start, shift.scheduled_end, shift.unpaid_break_minutes),
        unpaid_break_minutes: unpaidBreakMinutes(shift.unpaid_break_minutes),
      }));
    if (templateShifts.length) {
      let { error: shiftErr } = await supabase.from("schedule_template_shifts").insert(templateShifts);
      if (shiftErr && /unpaid_break|employee_id/.test(shiftErr.message || "")) {
        const stripped = templateShifts.map((row) => {
          const next = { ...row };
          if (/unpaid_break/.test(shiftErr.message || "")) delete next.unpaid_break_minutes;
          if (/employee_id/.test(shiftErr.message || "")) delete next.employee_id;
          return next;
        });
        const retry = await supabase.from("schedule_template_shifts").insert(stripped);
        shiftErr = retry.error;
      }
      if (shiftErr) {
        showToast(shiftErr.message || "Template saved, but shifts failed.");
        return;
      }
    }
    setTemplates((current) => [template, ...current]);
    setWeekTemplateName("");
    showToast("Template saved.", "success");
  }

  async function loadTemplate(templateId, mode) {
    if (published) return;
    setTemplatesOpen(false);
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
        const employeeId = resolveEmployeeId(employees, item);
        return shiftPayload(
          {
            shift_date: date,
            employee_id: employeeId,
            employee_name: item.employee_name,
            jolt_employee_id: item.jolt_employee_id || null,
            role: item.role || null,
            station: item.station || null,
            scheduled_start: item.scheduled_start,
            scheduled_end: item.scheduled_end,
            unpaid_break_minutes: item.unpaid_break_minutes,
            notes: null,
            source: SHIFT_SOURCE_HUB,
          },
          weekStart
        );
      })
      .filter(Boolean);

    if (payloads.length) {
      let { error: insErr } = await supabase.from("schedule_shifts").insert(payloads);
      if (insErr && /unpaid_break/.test(insErr.message || "")) {
        const stripped = payloads.map(({ unpaid_break_minutes: _b, ...rest }) => rest);
        const retry = await supabase.from("schedule_shifts").insert(stripped);
        insErr = retry.error;
      }
      if (insErr) {
        showToast(insErr.message || "Could not apply template shifts.");
        await loadWeek();
        return;
      }
    }
    await loadWeek();
    showToast(mode === "replace" ? "Template replaced this week." : "Template added to this week.", "success");
  }

  async function deleteTemplate(templateId) {
    const { error } = await supabase.from("schedule_templates").delete().eq("id", templateId);
    if (error) {
      showToast(error.message || "Could not delete template.");
      return;
    }
    setTemplates((current) => current.filter((t) => t.id !== templateId));
    showToast("Template deleted.", "success");
  }

  function onDragStartShift(shift, event) {
    if (published) {
      event.preventDefault();
      return;
    }
    const duplicate = event.ctrlKey || event.metaKey || duplicateModifierRef.current;
    skipCardClickRef.current = true;
    dragRef.current = { kind: duplicate ? "copy" : "shift", id: shift.id };
    event.dataTransfer.setData("text/plain", String(shift.id));
    event.dataTransfer.effectAllowed = duplicate ? "copy" : "move";
    if (duplicate) {
      setCopyDragId(shift.id);
      const ghost = document.createElement("div");
      ghost.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:#C8102E;color:#fff;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);";
      const plus = document.createElement("span");
      plus.textContent = "+";
      plus.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:999px;background:#fff;color:#C8102E;font-weight:800;";
      const label = document.createElement("span");
      label.textContent = `${formatClock(shift.scheduled_start)}–${formatClock(shift.scheduled_end)}`;
      ghost.append(plus, label);
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 16, 12);
      window.setTimeout(() => ghost.remove(), 0);
    }
  }

  function onDragOverCell(emp, date, event) {
    if (published || !dragRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragRef.current.kind === "copy" ? "copy" : "move";
    setDropTarget(`${rowKey(emp)}|${date}`);
  }

  function onDropCell(emp, date, event) {
    event.preventDefault();
    setDropTarget(null);
    const payload = dragRef.current;
    dragRef.current = null;
    if (!payload || published) return;
    if (payload.kind === "copy") {
      duplicateShift(payload.id, emp, date);
      return;
    }
    if (payload.kind === "shift") moveShift(payload.id, emp, date);
  }

  const modalEmployees = rows.filter(
    (emp) => !emp.isSynthetic || emp.isUnassigned || (modal && emp.id === modal.draft?.employeeId)
  );

  return (
    <section className="mx-auto flex w-full min-w-0 flex-1 flex-col gap-1.5 px-2 py-2">
      <fieldset disabled={daySaving} className="schedule-no-print flex min-w-0 flex-wrap items-center justify-between gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigateSchedule(-1)}
            aria-label={selectedDay ? "Previous day" : "Previous week"}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
          >
            ←
          </button>
          <p className="text-center text-xs font-bold text-[#C8102E]">
            {selectedDay ? formatLongDate(selectedDay) : formatWeekRange(weekStart)}
          </p>
          <button
            type="button"
            onClick={() => navigateSchedule(1)}
            aria-label={selectedDay ? "Next day" : "Next week"}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => {
              setWeekStart(weekStartSunday(getStoreToday()));
              if (selectedDay) setSelectedDay(getStoreToday());
            }}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
          >
            Today
          </button>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              published ? "bg-green-100 text-green-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {published ? "Published" : "Unpublished"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lg bg-zinc-100 px-2 py-1 font-semibold dark:bg-zinc-800">
            {formatHours(weekHours)} this week
          </span>
          <span className="text-zinc-500">{shifts.length} shifts</span>
        </div>
      </fieldset>

      <fieldset disabled={daySaving} aria-label="Schedule view" className="schedule-no-print grid min-w-0 grid-cols-4 overflow-hidden rounded-lg border border-zinc-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-900 sm:grid-cols-8">
        <button type="button" aria-pressed={!selectedDay} onClick={() => setSelectedDay(null)} className={`min-h-8 px-2 py-1 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#C8102E] ${!selectedDay ? "bg-[#C8102E] text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>Week view</button>
        {dates.map((date, index) => <button key={date} type="button" aria-pressed={selectedDay === date} onClick={() => setSelectedDay(date)} className={`min-h-8 border-l border-zinc-200 px-1 py-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#C8102E] dark:border-zinc-700 ${selectedDay === date ? "bg-[#C8102E] text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
          <span className="font-semibold">{DAY_LABELS[index]}</span> <span>{formatShortDate(date)}</span>
        </button>)}
      </fieldset>

      {published ? (
        <div className="schedule-no-print rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
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

      <fieldset disabled={daySaving || loading || Boolean(loadError)} className="schedule-no-print flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="relative" ref={templatesRef}>
          <button
            type="button"
            disabled={published}
            onClick={() => setTemplatesOpen((v) => !v)}
            className="min-h-8 rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-zinc-700"
          >
            Templates ▾
          </button>
          {templatesOpen ? (
            <div className="absolute left-0 z-20 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Create template</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={weekTemplateName}
                  onChange={(e) => setWeekTemplateName(e.target.value)}
                  placeholder="Name this week"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={saveWeekTemplate}
                  className="rounded-lg bg-[#C8102E] px-2 py-1.5 text-xs font-semibold text-white"
                >
                  Save
                </button>
              </div>
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-zinc-500">Apply template</p>
              {templates.length ? (
                <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {templates.map((tpl) => (
                    <li key={tpl.id} className="rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-700">
                      <p className="font-semibold">{tpl.name}</p>
                      <p className="text-zinc-500">{tpl.description || "Week template"}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => loadTemplate(tpl.id, "add")}
                          className="rounded border border-zinc-300 px-2 py-0.5 font-semibold"
                        >
                          Add to week
                        </button>
                        <button
                          type="button"
                          onClick={() => loadTemplate(tpl.id, "replace")}
                          className="rounded border border-zinc-300 px-2 py-0.5 font-semibold"
                        >
                          Replace week
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTemplate(tpl.id)}
                          className="rounded border border-red-200 px-2 py-0.5 font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">No saved templates yet.</p>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(`schedule-${selectedDay || weekStart}.csv`, shiftsToCsv(selectedDay ? shifts.filter((shift) => shift.shift_date === selectedDay) : shifts, weekStart))}
          className="min-h-8 rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-8 rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
        >
          Print
        </button>
        <button
          type="button"
          disabled={published}
          onClick={() => setPublished(true)}
          className="min-h-8 rounded-md bg-[#C8102E] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Publish week
        </button>
        <p className="text-xs text-zinc-500">
          {daySaving ? "Saving shift…" : selectedDay ? "Click an empty time slot or + to add a shift." : "Click a day to open its timeline. Click a cell to add; drag a card to move. Ctrl/Cmd-drag to copy."}
        </p>
      </fieldset>

      {loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          Loading week…
        </div>
      ) : (
        <>
          <p className="schedule-print-title mb-2 hidden text-lg font-bold text-[#C8102E] print:block">
            Arby&apos;s Payson · {selectedDay ? formatLongDate(selectedDay) : formatWeekRange(weekStart)}
          </p>
          {selectedDay ? <ScheduleDayView key={selectedDay} date={selectedDay} rows={rows} shiftsByRowDay={shiftsByRowDay} hoursByRow={hoursByRow} colorFor={(role) => roleColor(catalogRoles, role)} warningsFor={warningsFor} locked={published || Boolean(loadError)} saving={daySaving} onCreate={openCreate} onEdit={openEdit} onChange={changeDayShift} /> : <div className="schedule-print-grid overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {/* Fixed column sizing keeps empty, single-shift, and split-shift days equally wide. */}
            <table aria-label="Weekly schedule" className="w-full min-w-[1380px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[144px] print:w-[100px]" />
                {dates.map((date) => <col key={date} />)}
                <col className="w-[60px] print:w-[48px]" />
              </colgroup>
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800">
                  <th className="sticky left-0 z-10 border-b border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
                    Employee
                  </th>
                  {dates.map((date, idx) => (
                    <th key={date} className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
                      <button type="button" onClick={() => setSelectedDay(date)} aria-label={`View ${formatLongDate(date)} schedule`} className="w-full rounded py-1 text-left hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-[#C8102E]">
                        <span className="font-bold">{DAY_LABELS[idx]}</span>{" "}
                        <span className="font-normal text-zinc-500">{formatShortDate(date)}</span>
                      </button>
                    </th>
                  ))}
                  <th className="border-b border-zinc-200 px-1 py-1 dark:border-zinc-700">Hours</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((emp) => {
                  const hours = hoursByRow.get(rowKey(emp)) || 0;
                  const overtime = hours > 40;
                  return (
                    <tr key={rowKey(emp)} className="align-top">
                      <th className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-2 py-px text-left font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                        <span className="block truncate leading-[22px]" title={emp.fullName}>{emp.fullName}</span>
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
                            onClick={(e) => {
                              if (e.target.closest("[data-shift-card]")) return;
                              openCreate(emp, date);
                            }}
                            className={`h-[25px] cursor-pointer border-b border-r border-zinc-100 p-px dark:border-zinc-800 ${
                              active ? "bg-[#C8102E]/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                            }`}
                          >
                            <div className="flex min-h-[22px] min-w-0 flex-col gap-px">
                              {cellShifts.map((shift) => {
                                const color = roleColor(catalogRoles, shift.role);
                                const warns = warningsFor(shift, emp);
                                return (
                                  <button
                                    key={shift.id}
                                    type="button"
                                    data-shift-card="true"
                                    draggable={!published}
                                    onMouseDown={(e) => {
                                      duplicateModifierRef.current = e.ctrlKey || e.metaKey;
                                    }}
                                    onDragStart={(e) => onDragStartShift(shift, e)}
                                    onDragEnd={() => {
                                      skipCardClickRef.current = true;
                                      dragRef.current = null;
                                      duplicateModifierRef.current = false;
                                      setCopyDragId(null);
                                      setDropTarget(null);
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (skipCardClickRef.current) {
                                        skipCardClickRef.current = false;
                                        return;
                                      }
                                      openEdit(shift);
                                    }}
                                    className={`relative flex h-[22px] w-full min-w-0 shrink-0 items-center gap-1 rounded px-1 text-left text-[11px] leading-4 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#C8102E] ${
                                      copyDragId === shift.id ? "cursor-copy ring-2 ring-white ring-offset-1 ring-offset-[#C8102E]" : ""
                                    }`}
                                    style={{ background: color, color: contrastText(color), printColorAdjust: "exact" }}
                                    title={
                                      [
                                        `${shift.role || "Shift"} ${formatClock(shift.scheduled_start)}–${formatClock(shift.scheduled_end)}`,
                                        shift.station,
                                        ...warns,
                                      ].filter(Boolean).join(" · ")
                                    }
                                  >
                                    <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">
                                      {formatClock(shift.scheduled_start)}–{formatClock(shift.scheduled_end)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate font-semibold">
                                      {shift.role || "No role"}
                                    </span>
                                    {warns.length ? <span className="shrink-0" aria-label={warns.join(". ")}>⚠️</span> : null}
                                    {copyDragId === shift.id ? (
                                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#C8102E]">
                                        +
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                      <td className="border-b border-zinc-100 px-1 py-px font-semibold leading-[22px] tabular-nums dark:border-zinc-800">
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
          </div>}
        </>
      )}

      {!loading && scheduledRoles.length ? (
        <div aria-label="Shift role colors" className="flex flex-wrap gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
          <span className="font-semibold">Roles this week:</span>
          {scheduledRoles.map((role) => (
            <span key={role.key} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: role.color, printColorAdjust: "exact" }} />
              {role.name}
            </span>
          ))}
        </div>
      ) : null}

      {modal && !published ? (
        <ShiftModal
          mode={modal.mode}
          draft={modal.draft}
          employees={modalEmployees.length ? modalEmployees : rows}
          hoursByRow={hoursByRow}
          stations={stations}
          roles={distinctRoles}
          catalogRoles={catalogRoles}
          onClose={() => setModal(null)}
          onSave={saveFromModal}
          onDelete={() => deleteShift(modal.shift)}
          onCallOut={() => markCallOut(modal.shift)}
        />
      ) : null}

      <ScheduleToast toast={toast} />
    </section>
  );
}
