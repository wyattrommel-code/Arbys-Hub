import { STORE_ID } from "./constants";
import { employeeFullName, matchesEmployeeByName } from "./employees";
import { canApproveOffers } from "./permissions";
import {
  SCHEDULE_STORE_ID,
  UNASSIGNED_EMPLOYEE_NAME,
  computeScheduledHours,
  formatClock,
  formatHours,
  formatLongDate,
  isUnassignedName,
  nameKey,
  timeToMinutes,
  weekStartSunday,
} from "./schedule";
import { addDaysISO, getStoreToday } from "./store-time";

export const OFFER_STORE_ID = SCHEDULE_STORE_ID;

export const OFFER_STATUS_LABELS = {
  open: "Open",
  claimed: "Awaiting approval",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

export const OFFER_TYPE_LABELS = {
  drop: "Drop",
  swap: "Swap",
};

const SHIFT_SELECT =
  "id, shift_date, employee_name, jolt_employee_id, scheduled_start, scheduled_end, unpaid_break_minutes, scheduled_hours, role, station, week_start_date";

const OFFER_SELECT =
  "id, shift_id, offered_by_id, offered_by_name, offer_type, swap_target_shift_id, claimed_by_id, claimed_by_name, status, approved_by, approved_by_id, reviewed_at, note, store_id";

const HUB_EMPLOYEE_SELECTS = [
  "id, first_name, last_name, role, is_manager, is_assistant_manager, jolt_employee_id, is_active",
  "id, first_name, last_name, role, is_assistant_manager, jolt_employee_id, is_active",
  "id, first_name, last_name, role, jolt_employee_id, is_active",
  "id, first_name, last_name, role, is_active",
];

function isMissingColumnError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /column|schema cache|could not find/i.test(msg);
}

export function hubEmployeeName(emp) {
  if (!emp) return "";
  return employeeFullName(emp) || `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
}

export function shiftAbsStartMs(shift) {
  const day = Date.parse(`${shift.shift_date}T00:00:00Z`);
  const mins = timeToMinutes(shift.scheduled_start);
  if (!Number.isFinite(day) || mins == null) return null;
  return day + mins * 60000;
}

export function shiftAbsEndMs(shift) {
  const start = shiftAbsStartMs(shift);
  const s = timeToMinutes(shift.scheduled_start);
  const e = timeToMinutes(shift.scheduled_end);
  if (start == null || s == null || e == null) return null;
  let dur = e - s;
  if (dur <= 0) dur += 24 * 60;
  return start + dur * 60000;
}

/** Soft double-book check — same idea as the builder ⚠️, never a hard block. */
export function shiftsOverlap(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const a0 = shiftAbsStartMs(a);
  const a1 = shiftAbsEndMs(a);
  const b0 = shiftAbsStartMs(b);
  const b1 = shiftAbsEndMs(b);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  return a0 < b1 && b0 < a1;
}

export function isUpcomingShift(shift, today = getStoreToday()) {
  return Boolean(shift?.shift_date) && String(shift.shift_date) >= today;
}

export function shiftAssignedTo(shift, employee) {
  if (!shift || !employee || isUnassignedName(shift.employee_name)) return false;
  const joltEmp = employee.jolt_employee_id != null ? String(employee.jolt_employee_id) : "";
  const joltShift = shift.jolt_employee_id != null ? String(shift.jolt_employee_id) : "";
  if (joltEmp && joltShift && joltEmp === joltShift) return true;
  return matchesEmployeeByName(shift.employee_name, employee);
}

export function findEmployeeForShift(employees, shift) {
  if (!shift || isUnassignedName(shift.employee_name)) return null;
  const jolt = shift.jolt_employee_id != null ? String(shift.jolt_employee_id) : "";
  if (jolt) {
    const byJolt = (employees || []).find((e) => String(e.jolt_employee_id || "") === jolt);
    if (byJolt) return byJolt;
  }
  return (employees || []).find((e) => matchesEmployeeByName(shift.employee_name, e)) || null;
}

export function serializeShiftCard(shift, extras = {}) {
  if (!shift) return null;
  const hours =
    Number(shift.scheduled_hours) ||
    computeScheduledHours(shift.scheduled_start, shift.scheduled_end, shift.unpaid_break_minutes);
  return {
    id: shift.id,
    date: shift.shift_date,
    date_label: formatLongDate(shift.shift_date),
    start_label: formatClock(shift.scheduled_start),
    end_label: formatClock(shift.scheduled_end),
    hours_label: formatHours(hours),
    role: shift.role || "",
    station: shift.station || "",
    employee_name: isUnassignedName(shift.employee_name) ? "Unassigned" : shift.employee_name || "",
    unassigned: isUnassignedName(shift.employee_name),
    ...extras,
  };
}

function overlapWarningForPerson(name, incoming, existingShifts) {
  const hits = (existingShifts || []).filter((s) => shiftsOverlap(incoming, s));
  if (!hits.length) return null;
  return `${name} would overlap another shift ⚠️`;
}

export async function fetchHubEmployee(supabase, employeeId) {
  if (!employeeId) return null;
  let lastError = null;
  for (const select of HUB_EMPLOYEE_SELECTS) {
    const { data, error } = await supabase
      .from("employees")
      .select(select)
      .eq("store_id", STORE_ID)
      .eq("id", employeeId)
      .maybeSingle();
    if (!error) return data;
    lastError = error;
    if (!isMissingColumnError(error)) throw error;
  }
  if (lastError) throw lastError;
  return null;
}

export async function fetchHubEmployees(supabase) {
  let lastError = null;
  for (const select of HUB_EMPLOYEE_SELECTS) {
    const { data, error } = await supabase
      .from("employees")
      .select(select)
      .eq("store_id", STORE_ID)
      .eq("is_active", true);
    if (!error) return data || [];
    lastError = error;
    if (!isMissingColumnError(error)) throw error;
  }
  if (lastError) throw lastError;
  return [];
}

async function fetchPublishedWeekStarts(supabase, fromDate, toDate) {
  const fromWeek = weekStartSunday(fromDate);
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select("week_start_date, status")
    .eq("store_id", OFFER_STORE_ID)
    .gte("week_start_date", fromWeek)
    .lte("week_start_date", toDate)
    .eq("status", "published");
  if (error) throw error;
  return new Set((data || []).map((row) => row.week_start_date));
}

async function fetchShiftsInRange(supabase, fromDate, toDate) {
  const { data, error } = await supabase
    .from("schedule_shifts")
    .select(SHIFT_SELECT)
    .eq("store_id", OFFER_STORE_ID)
    .gte("shift_date", fromDate)
    .lte("shift_date", toDate)
    .order("shift_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchShift(supabase, id) {
  const { data, error } = await supabase
    .from("schedule_shifts")
    .select(SHIFT_SELECT)
    .eq("id", id)
    .eq("store_id", OFFER_STORE_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchOffer(supabase, id) {
  const { data, error } = await supabase
    .from("shift_offers")
    .select(OFFER_SELECT)
    .eq("id", id)
    .eq("store_id", OFFER_STORE_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchActiveOffersForShifts(supabase, shiftIds) {
  if (!shiftIds.length) return [];
  const { data, error } = await supabase
    .from("shift_offers")
    .select(OFFER_SELECT)
    .eq("store_id", OFFER_STORE_ID)
    .in("shift_id", shiftIds)
    .in("status", ["open", "claimed"]);
  if (error) throw error;
  return data || [];
}

async function isWeekPublished(supabase, weekStart) {
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select("status")
    .eq("store_id", OFFER_STORE_ID)
    .eq("week_start_date", weekStart)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return data?.status === "published";
}

function assigneePatch(employee) {
  if (!employee) {
    return { employee_name: UNASSIGNED_EMPLOYEE_NAME, jolt_employee_id: null };
  }
  return {
    employee_name: hubEmployeeName(employee),
    jolt_employee_id: employee.jolt_employee_id || null,
  };
}

function serializeOffer(offer, shift, targetShift = null, extras = {}) {
  return {
    id: offer.id,
    type: offer.offer_type,
    type_label: OFFER_TYPE_LABELS[offer.offer_type] || offer.offer_type,
    status: offer.status,
    status_label: OFFER_STATUS_LABELS[offer.status] || offer.status,
    offered_by_name: offer.offered_by_name || "",
    claimed_by_name: offer.claimed_by_name || "",
    approved_by: offer.approved_by || "",
    reviewed_at: offer.reviewed_at || null,
    note: offer.note || "",
    shift: serializeShiftCard(shift),
    target_shift: serializeShiftCard(targetShift),
    shift_id: offer.shift_id,
    swap_target_shift_id: offer.swap_target_shift_id,
    ...extras,
  };
}

export async function loadMarketplace(supabase, sessionEmployee) {
  const today = getStoreToday();
  const toDate = addDaysISO(today, 20);
  const hub = await fetchHubEmployee(supabase, sessionEmployee.employee_id);
  const me = {
    ...sessionEmployee,
    id: sessionEmployee.employee_id,
    first_name: hub?.first_name || sessionEmployee.first_name,
    last_name: hub?.last_name || sessionEmployee.last_name,
    role: hub?.role || sessionEmployee.role,
    jolt_employee_id: hub?.jolt_employee_id || null,
    is_assistant_manager: hub?.is_assistant_manager,
    is_manager: hub?.is_manager,
  };
  const myName = hubEmployeeName(me);
  const publishedWeeks = await fetchPublishedWeekStarts(supabase, today, toDate);
  const allShifts = (await fetchShiftsInRange(supabase, today, toDate)).filter((s) =>
    publishedWeeks.has(s.week_start_date || weekStartSunday(s.shift_date))
  );
  const myShifts = allShifts.filter((s) => shiftAssignedTo(s, me));
  const others = allShifts.filter((s) => !shiftAssignedTo(s, me) && !isUnassignedName(s.employee_name));
  const unassigned = allShifts.filter((s) => isUnassignedName(s.employee_name));

  const [{ data: asOfferer, error: offererErr }, { data: asClaimer, error: claimerErr }] = await Promise.all([
    supabase
      .from("shift_offers")
      .select(OFFER_SELECT)
      .eq("store_id", OFFER_STORE_ID)
      .eq("offered_by_id", sessionEmployee.employee_id)
      .order("id", { ascending: false }),
    supabase
      .from("shift_offers")
      .select(OFFER_SELECT)
      .eq("store_id", OFFER_STORE_ID)
      .eq("claimed_by_id", sessionEmployee.employee_id)
      .order("id", { ascending: false }),
  ]);
  if (offererErr) throw offererErr;
  if (claimerErr) throw claimerErr;
  const seen = new Set();
  const myOfferRows = [];
  for (const row of [...(asOfferer || []), ...(asClaimer || [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    myOfferRows.push(row);
  }
  myOfferRows.sort((a, b) => String(b.id).localeCompare(String(a.id)));

  const { data: openDrops, error: openErr } = await supabase
    .from("shift_offers")
    .select(OFFER_SELECT)
    .eq("store_id", OFFER_STORE_ID)
    .eq("offer_type", "drop")
    .eq("status", "open")
    .order("id", { ascending: false });
  if (openErr) throw openErr;

  const relatedIds = [
    ...new Set(
      [...(myOfferRows || []), ...(openDrops || [])]
        .flatMap((o) => [o.shift_id, o.swap_target_shift_id])
        .filter(Boolean)
    ),
  ];
  const extraShifts = [];
  if (relatedIds.length) {
    const { data, error } = await supabase
      .from("schedule_shifts")
      .select(SHIFT_SELECT)
      .eq("store_id", OFFER_STORE_ID)
      .in("id", relatedIds);
    if (error) throw error;
    extraShifts.push(...(data || []));
  }
  const shiftMap = new Map([...allShifts, ...extraShifts].map((s) => [s.id, s]));

  const activeByShift = new Map();
  for (const offer of myOfferRows || []) {
    if (offer.status === "open" || offer.status === "claimed") {
      activeByShift.set(offer.shift_id, offer);
    }
  }

  const pickupFromDrops = [];
  for (const offer of openDrops || []) {
    if (offer.offered_by_id === sessionEmployee.employee_id) continue;
    const shift = shiftMap.get(offer.shift_id);
    if (!shift || !isUpcomingShift(shift, today)) continue;
    const warning = overlapWarningForPerson(myName, shift, myShifts);
    pickupFromDrops.push(
      serializeOffer(offer, shift, null, {
        overlap_warning: warning,
        source: "drop",
      })
    );
  }

  const pickupUnassigned = unassigned.map((shift) => {
    const warning = overlapWarningForPerson(myName, shift, myShifts);
    return serializeShiftCard(shift, {
      source: "unassigned",
      overlap_warning: warning,
    });
  });

  return {
    can_approve: canApproveOffers(me),
    my_shifts: myShifts.map((shift) =>
      serializeShiftCard(shift, {
        active_offer_status: activeByShift.get(shift.id)?.status || null,
        active_offer_id: activeByShift.get(shift.id)?.id || null,
      })
    ),
    pickup_drops: pickupFromDrops,
    pickup_open: pickupUnassigned,
    swap_targets: others.map((shift) => serializeShiftCard(shift)),
    my_offers: (myOfferRows || []).map((offer) =>
      serializeOffer(offer, shiftMap.get(offer.shift_id), shiftMap.get(offer.swap_target_shift_id))
    ),
  };
}

export async function loadApprovalQueue(supabase, sessionEmployee) {
  const hub = await fetchHubEmployee(supabase, sessionEmployee.employee_id);
  const me = { ...sessionEmployee, ...hub, role: hub?.role || sessionEmployee.role };
  const today = getStoreToday();
  const toDate = addDaysISO(today, 41);

  const { data: offers, error } = await supabase
    .from("shift_offers")
    .select(OFFER_SELECT)
    .eq("store_id", OFFER_STORE_ID)
    .in("status", ["open", "claimed"])
    .order("id", { ascending: false });
  if (error) throw error;

  const shiftIds = [
    ...new Set((offers || []).flatMap((o) => [o.shift_id, o.swap_target_shift_id]).filter(Boolean)),
  ];
  const shiftMap = new Map();
  if (shiftIds.length) {
    const { data: shiftRows, error: shiftErr } = await supabase
      .from("schedule_shifts")
      .select(SHIFT_SELECT)
      .eq("store_id", OFFER_STORE_ID)
      .in("id", shiftIds);
    if (shiftErr) throw shiftErr;
    for (const row of shiftRows || []) shiftMap.set(row.id, row);
  }

  const rangeShifts = await fetchShiftsInRange(supabase, today, toDate);
  const roster = await fetchHubEmployees(supabase);

  const pending = [];
  const openDrops = [];
  for (const offer of offers || []) {
    const shift = shiftMap.get(offer.shift_id);
    const target = offer.swap_target_shift_id ? shiftMap.get(offer.swap_target_shift_id) : null;
    const warnings = [];
    if (offer.offer_type === "drop" && offer.status === "claimed" && shift) {
      const claimer = roster.find((e) => e.id === offer.claimed_by_id);
      const existing = rangeShifts.filter((s) => claimer && shiftAssignedTo(s, claimer) && s.id !== shift.id);
      const warn = overlapWarningForPerson(offer.claimed_by_name || "Claimer", shift, existing);
      if (warn) warnings.push(warn);
    }
    if (offer.offer_type === "swap" && shift && target) {
      const offerer = roster.find((e) => e.id === offer.offered_by_id);
      const claimer = roster.find((e) => e.id === offer.claimed_by_id) || findEmployeeForShift(roster, target);
      const offererExisting = rangeShifts.filter((s) => offerer && shiftAssignedTo(s, offerer) && s.id !== shift.id);
      const claimerExisting = rangeShifts.filter((s) => claimer && shiftAssignedTo(s, claimer) && s.id !== target.id);
      const w1 = overlapWarningForPerson(offer.offered_by_name || "Offerer", target, offererExisting);
      const w2 = overlapWarningForPerson(offer.claimed_by_name || "Other person", shift, claimerExisting);
      if (w1) warnings.push(w1);
      if (w2) warnings.push(w2);
    }
    const row = serializeOffer(offer, shift, target, { overlap_warnings: warnings });
    if (offer.status === "claimed" || offer.offer_type === "swap") pending.push(row);
    else if (offer.offer_type === "drop" && offer.status === "open") openDrops.push(row);
  }

  return {
    can_approve: canApproveOffers(me),
    pending,
    open_drops: openDrops,
  };
}

export async function createOffer(supabase, sessionEmployee, body) {
  const type = String(body.type || "").trim();
  const shiftId = body.shift_id;
  const note = String(body.note || "").trim();
  if (!shiftId) throw Object.assign(new Error("Pick a shift."), { status: 400 });

  const hub = await fetchHubEmployee(supabase, sessionEmployee.employee_id);
  const me = {
    ...sessionEmployee,
    id: sessionEmployee.employee_id,
    first_name: hub?.first_name || sessionEmployee.first_name,
    last_name: hub?.last_name || sessionEmployee.last_name,
    jolt_employee_id: hub?.jolt_employee_id || null,
  };
  const myName = hubEmployeeName(me);
  const today = getStoreToday();

  if (type === "pickup_open") {
    const shift = await fetchShift(supabase, shiftId);
    if (!shift) throw Object.assign(new Error("Shift not found."), { status: 404 });
    if (!isUpcomingShift(shift, today)) throw Object.assign(new Error("That shift is in the past."), { status: 400 });
    if (!isUnassignedName(shift.employee_name)) {
      throw Object.assign(new Error("That shift is already assigned. Claim the drop instead."), { status: 400 });
    }
    const weekStart = shift.week_start_date || weekStartSunday(shift.shift_date);
    if (!(await isWeekPublished(supabase, weekStart))) {
      throw Object.assign(new Error("That week is not published yet."), { status: 400 });
    }
    const existing = await fetchActiveOffersForShifts(supabase, [shift.id]);
    if (existing.length) throw Object.assign(new Error("Someone already claimed that open shift."), { status: 409 });
    const row = {
      shift_id: shift.id,
      offered_by_name: UNASSIGNED_EMPLOYEE_NAME,
      offer_type: "drop",
      swap_target_shift_id: null,
      claimed_by_id: sessionEmployee.employee_id,
      claimed_by_name: myName,
      status: "claimed",
      note: note || null,
      store_id: OFFER_STORE_ID,
    };
    let inserted = await supabase.from("shift_offers").insert({ ...row, offered_by_id: null }).select(OFFER_SELECT).single();
    if (inserted.error && /null|not-null|violat/i.test(inserted.error.message || "")) {
      inserted = await supabase
        .from("shift_offers")
        .insert({ ...row, offered_by_id: sessionEmployee.employee_id })
        .select(OFFER_SELECT)
        .single();
    }
    if (inserted.error) throw inserted.error;
    return inserted.data;
  }

  const shift = await fetchShift(supabase, shiftId);
  if (!shift) throw Object.assign(new Error("Shift not found."), { status: 404 });
  if (!isUpcomingShift(shift, today)) throw Object.assign(new Error("That shift is in the past."), { status: 400 });
  if (!shiftAssignedTo(shift, me)) throw Object.assign(new Error("You can only offer your own shift."), { status: 403 });
  const weekStart = shift.week_start_date || weekStartSunday(shift.shift_date);
  if (!(await isWeekPublished(supabase, weekStart))) {
    throw Object.assign(new Error("That week is not published yet."), { status: 400 });
  }

  const existing = await fetchActiveOffersForShifts(supabase, [shift.id]);
  if (existing.length) throw Object.assign(new Error("You already have an open offer on this shift."), { status: 409 });

  if (type === "drop") {
    const { data, error } = await supabase
      .from("shift_offers")
      .insert({
        shift_id: shift.id,
        offered_by_id: sessionEmployee.employee_id,
        offered_by_name: myName,
        offer_type: "drop",
        swap_target_shift_id: null,
        claimed_by_id: null,
        claimed_by_name: null,
        status: "open",
        note: note || null,
        store_id: OFFER_STORE_ID,
      })
      .select(OFFER_SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  if (type === "swap") {
    const targetId = body.swap_target_shift_id;
    if (!targetId) throw Object.assign(new Error("Pick the shift you want to swap for."), { status: 400 });
    const target = await fetchShift(supabase, targetId);
    if (!target) throw Object.assign(new Error("The other shift was not found."), { status: 404 });
    if (target.id === shift.id) throw Object.assign(new Error("Pick a different shift to swap."), { status: 400 });
    if (!isUpcomingShift(target, today)) throw Object.assign(new Error("The other shift is in the past."), { status: 400 });
    if (isUnassignedName(target.employee_name)) {
      throw Object.assign(new Error("Pick up an open shift instead of swapping for it."), { status: 400 });
    }
    if (shiftAssignedTo(target, me)) {
      throw Object.assign(new Error("That shift is already yours."), { status: 400 });
    }
    const targetWeek = target.week_start_date || weekStartSunday(target.shift_date);
    if (!(await isWeekPublished(supabase, targetWeek))) {
      throw Object.assign(new Error("The other shift's week is not published yet."), { status: 400 });
    }
    const roster = await fetchHubEmployees(supabase);
    const other = findEmployeeForShift(roster, target);
    if (!other) {
      throw Object.assign(new Error("Could not match the other person on the roster."), { status: 400 });
    }
    const { data, error } = await supabase
      .from("shift_offers")
      .insert({
        shift_id: shift.id,
        offered_by_id: sessionEmployee.employee_id,
        offered_by_name: myName,
        offer_type: "swap",
        swap_target_shift_id: target.id,
        claimed_by_id: other.id,
        claimed_by_name: hubEmployeeName(other),
        status: "claimed",
        note: note || null,
        store_id: OFFER_STORE_ID,
      })
      .select(OFFER_SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  throw Object.assign(new Error("Unknown offer type."), { status: 400 });
}

export async function claimDropOffer(supabase, sessionEmployee, offerId) {
  const hub = await fetchHubEmployee(supabase, sessionEmployee.employee_id);
  const me = {
    ...sessionEmployee,
    id: sessionEmployee.employee_id,
    first_name: hub?.first_name || sessionEmployee.first_name,
    last_name: hub?.last_name || sessionEmployee.last_name,
    jolt_employee_id: hub?.jolt_employee_id || null,
  };
  const offer = await fetchOffer(supabase, offerId);
  if (!offer) throw Object.assign(new Error("Offer not found."), { status: 404 });
  if (offer.offer_type !== "drop" || offer.status !== "open") {
    throw Object.assign(new Error("That drop is no longer open."), { status: 409 });
  }
  if (offer.offered_by_id === sessionEmployee.employee_id) {
    throw Object.assign(new Error("You cannot pick up your own drop."), { status: 400 });
  }
  const shift = await fetchShift(supabase, offer.shift_id);
  if (!shift) throw Object.assign(new Error("Shift not found."), { status: 404 });
  if (!isUpcomingShift(shift)) throw Object.assign(new Error("That shift is in the past."), { status: 400 });
  if (shiftAssignedTo(shift, me)) throw Object.assign(new Error("That shift is already yours."), { status: 400 });

  const { data, error } = await supabase
    .from("shift_offers")
    .update({
      claimed_by_id: sessionEmployee.employee_id,
      claimed_by_name: hubEmployeeName(me),
      status: "claimed",
    })
    .eq("id", offer.id)
    .eq("store_id", OFFER_STORE_ID)
    .eq("status", "open")
    .select(OFFER_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Someone else already claimed that drop."), { status: 409 });
  return data;
}

export async function cancelOffer(supabase, sessionEmployee, offerId) {
  const offer = await fetchOffer(supabase, offerId);
  if (!offer) throw Object.assign(new Error("Offer not found."), { status: 404 });
  if (!["open", "claimed"].includes(offer.status)) {
    throw Object.assign(new Error("That offer can no longer be cancelled."), { status: 409 });
  }
  const isOfferer = offer.offered_by_id === sessionEmployee.employee_id;
  const isClaimer = offer.claimed_by_id === sessionEmployee.employee_id;
  if (!isOfferer && !isClaimer) {
    throw Object.assign(new Error("You can only cancel your own offer."), { status: 403 });
  }

  if (isClaimer && !isOfferer && offer.status === "claimed" && offer.offer_type === "drop") {
    const { data, error } = await supabase
      .from("shift_offers")
      .update({
        claimed_by_id: null,
        claimed_by_name: null,
        status: "open",
      })
      .eq("id", offer.id)
      .eq("status", "claimed")
      .select(OFFER_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("That offer already moved on."), { status: 409 });
    return data;
  }

  const { data, error } = await supabase
    .from("shift_offers")
    .update({ status: "cancelled" })
    .eq("id", offer.id)
    .in("status", ["open", "claimed"])
    .select(OFFER_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("That offer already moved on."), { status: 409 });
  return data;
}

export async function reviewOffer(supabase, sessionEmployee, offerId, action, note) {
  const hub = await fetchHubEmployee(supabase, sessionEmployee.employee_id);
  const me = { ...sessionEmployee, ...hub, role: hub?.role || sessionEmployee.role };
  if (!canApproveOffers(me)) {
    throw Object.assign(new Error("Only a GM or assistant manager can approve coverage changes."), { status: 403 });
  }
  const offer = await fetchOffer(supabase, offerId);
  if (!offer) throw Object.assign(new Error("Offer not found."), { status: 404 });
  if (!["open", "claimed"].includes(offer.status)) {
    throw Object.assign(new Error("That offer was already reviewed."), { status: 409 });
  }

  const actor = hubEmployeeName(me) || `${sessionEmployee.first_name} ${sessionEmployee.last_name}`.trim();
  const stamp = {
    approved_by: actor,
    approved_by_id: sessionEmployee.employee_id,
    reviewed_at: new Date().toISOString(),
    note: note ? String(note).trim() : offer.note,
  };

  if (action === "deny") {
    const { data, error } = await supabase
      .from("shift_offers")
      .update({ status: "denied", ...stamp })
      .eq("id", offer.id)
      .in("status", ["open", "claimed"])
      .select(OFFER_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("That offer was already reviewed."), { status: 409 });
    return data;
  }

  if (action !== "approve" && action !== "approve_open") {
    throw Object.assign(new Error("Unknown review action."), { status: 400 });
  }

  const shift = await fetchShift(supabase, offer.shift_id);
  if (!shift) throw Object.assign(new Error("Shift not found."), { status: 404 });
  if (
    offer.offer_type === "drop" &&
    offer.offered_by_name &&
    !isUnassignedName(offer.offered_by_name) &&
    !isUnassignedName(shift.employee_name) &&
    nameKey(shift.employee_name) !== nameKey(offer.offered_by_name)
  ) {
    throw Object.assign(new Error("This shift was already reassigned. Deny the offer."), { status: 409 });
  }
  const roster = await fetchHubEmployees(supabase);

  if (offer.offer_type === "swap") {
    const target = await fetchShift(supabase, offer.swap_target_shift_id);
    if (!target) throw Object.assign(new Error("The other shift was not found."), { status: 404 });
    const offerer = roster.find((e) => e.id === offer.offered_by_id) || (await fetchHubEmployee(supabase, offer.offered_by_id));
    const other =
      roster.find((e) => e.id === offer.claimed_by_id) ||
      findEmployeeForShift(roster, target) ||
      (offer.claimed_by_id ? await fetchHubEmployee(supabase, offer.claimed_by_id) : null);
    if (!offerer || !other) {
      throw Object.assign(new Error("Could not match both people on the roster."), { status: 400 });
    }
    const a = assigneePatch(other);
    const b = assigneePatch(offerer);
    const first = await supabase
      .from("schedule_shifts")
      .update(a)
      .eq("id", shift.id)
      .eq("store_id", OFFER_STORE_ID);
    if (first.error) throw first.error;
    const second = await supabase
      .from("schedule_shifts")
      .update(b)
      .eq("id", target.id)
      .eq("store_id", OFFER_STORE_ID);
    if (second.error) {
      await supabase.from("schedule_shifts").update(assigneePatch(offerer)).eq("id", shift.id).eq("store_id", OFFER_STORE_ID);
      throw second.error;
    }
  } else if (action === "approve_open") {
    const { error } = await supabase
      .from("schedule_shifts")
      .update(assigneePatch(null))
      .eq("id", shift.id)
      .eq("store_id", OFFER_STORE_ID);
    if (error) throw error;
  } else {
    if (offer.status !== "claimed" || !offer.claimed_by_id) {
      throw Object.assign(
        new Error("Nobody picked this up. Approve as open to make it Unassigned, or wait for a pickup."),
        { status: 400 }
      );
    }
    const claimer = roster.find((e) => e.id === offer.claimed_by_id) || (await fetchHubEmployee(supabase, offer.claimed_by_id));
    if (!claimer) throw Object.assign(new Error("Could not match the claimer on the roster."), { status: 400 });
    const { error } = await supabase
      .from("schedule_shifts")
      .update(assigneePatch(claimer))
      .eq("id", shift.id)
      .eq("store_id", OFFER_STORE_ID);
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("shift_offers")
    .update({ status: "approved", ...stamp })
    .eq("id", offer.id)
    .in("status", ["open", "claimed"])
    .select(OFFER_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("That offer was already reviewed."), { status: 409 });
  return data;
}

export function httpError(err) {
  const status = Number(err?.status) || 500;
  return { status, message: err?.message || "Request failed." };
}
