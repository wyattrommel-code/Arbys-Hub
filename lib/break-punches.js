import { SCHEDULE_STORE_ID } from "./schedule";
import { toStoredMinutes } from "./timecards";

const BREAK_STORE_ID = SCHEDULE_STORE_ID;

function isMissingRelationError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`;
  return /does not exist|schema cache|relation/i.test(msg);
}

export function isOnBreak(punch) {
  return Boolean(punch?.on_break);
}

export function totalBreakMinutes(punch) {
  return toStoredMinutes(punch?.total_break_minutes);
}

export async function fetchOpenBreak(supabase, timePunchId) {
  if (!timePunchId) return null;
  const { data, error } = await supabase
    .from("break_punches")
    .select("id, time_punch_id, employee_id, employee_name, break_start, break_end, break_minutes, status")
    .eq("time_punch_id", timePunchId)
    .eq("status", "open")
    .order("break_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  return data || null;
}

export async function fetchBreaksForPunches(supabase, punchIds) {
  const ids = [...new Set((punchIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("break_punches")
    .select(
      "id, time_punch_id, employee_id, employee_name, break_start, break_end, break_minutes, status"
    )
    .in("time_punch_id", ids)
    .eq("store_id", BREAK_STORE_ID)
    .order("break_start", { ascending: true });
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return data || [];
}

export function serializeOpenBreak(row) {
  if (!row) return null;
  return { id: row.id, break_start: row.break_start };
}

/** If the punch is flagged on_break but has no open row, clear the flag. */
export async function healOrphanOnBreak(supabase, punch) {
  if (!punch?.id || !isOnBreak(punch)) return punch;
  const open = await fetchOpenBreak(supabase, punch.id);
  if (open) return punch;
  const { error } = await supabase
    .from("time_punches")
    .update({ on_break: false })
    .eq("id", punch.id)
    .eq("status", "open");
  if (error && !/on_break|column|schema cache/i.test(error.message || "")) throw error;
  return { ...punch, on_break: false };
}

export async function startBreakPunch(supabase, { punch, employee, employeeName }) {
  const existing = await fetchOpenBreak(supabase, punch.id);
  if (existing) {
    const err = new Error("Already on break. End break first.");
    err.status = 409;
    throw err;
  }
  if (isOnBreak(punch)) {
    await healOrphanOnBreak(supabase, punch);
  }
  const now = new Date().toISOString();
  const { data: row, error } = await supabase
    .from("break_punches")
    .insert({
      time_punch_id: punch.id,
      employee_id: employee.id,
      employee_name: employeeName,
      break_start: now,
      break_end: null,
      break_minutes: null,
      status: "open",
      store_id: BREAK_STORE_ID,
    })
    .select("id, break_start, status")
    .single();
  if (error) throw error;

  const { error: upErr } = await supabase
    .from("time_punches")
    .update({ on_break: true })
    .eq("id", punch.id)
    .eq("status", "open");
  if (upErr) throw upErr;

  return row;
}

export async function endBreakPunch(supabase, { punch }) {
  const openBreak = await fetchOpenBreak(supabase, punch.id);
  if (!openBreak) {
    if (isOnBreak(punch)) {
      const { error: clearErr } = await supabase
        .from("time_punches")
        .update({ on_break: false })
        .eq("id", punch.id)
        .eq("status", "open");
      if (clearErr) throw clearErr;
      const err = new Error("No open break to end.");
      err.status = 409;
      throw err;
    }
    const err = new Error("No open break to end.");
    err.status = 409;
    throw err;
  }
  const breakEnd = new Date().toISOString();
  const minutes = toStoredMinutes(
    (new Date(breakEnd).getTime() - new Date(openBreak.break_start).getTime()) / 60000
  );
  const { data: row, error } = await supabase
    .from("break_punches")
    .update({
      break_end: breakEnd,
      break_minutes: minutes,
      status: "closed",
    })
    .eq("id", openBreak.id)
    .eq("status", "open")
    .select("id, break_start, break_end, break_minutes, status")
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    const err = new Error("Break was already ended.");
    err.status = 409;
    throw err;
  }

  const nextTotal = toStoredMinutes(totalBreakMinutes(punch) + minutes);
  const { error: upErr } = await supabase
    .from("time_punches")
    .update({ on_break: false, total_break_minutes: nextTotal })
    .eq("id", punch.id)
    .eq("status", "open");
  if (upErr) throw upErr;

  return { ...row, total_break_minutes: nextTotal };
}
