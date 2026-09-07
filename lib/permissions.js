/** @typedef {'crew' | 'shift_lead' | 'assistant_manager' | 'gm'} HubRole */

const ROLE_RANK = {
  crew: 0,
  shift_lead: 1,
  assistant_manager: 2,
  gm: 3,
};

export const HUB_ROLE_OPTIONS = [
  { value: "crew", label: "Crew" },
  { value: "shift_lead", label: "Shift Lead" },
  { value: "assistant_manager", label: "Assistant Manager" },
  { value: "gm", label: "GM" },
];

/** Minimum role required per feature. Higher roles inherit lower permissions. */
export const FEATURE_MIN_ROLE = {
  home: "crew",
  "checklists.complete": "crew",
  "checklists.manage": "gm",
  roast_beef: "crew",
  "deployment.view": "crew",
  "deployment.submit": "shift_lead",
  "waste.submit": "crew",
  "waste.reports": "gm",
  "inventory.view_edit": "crew",
  "inventory.manage": "gm",
  "schedule.own": "crew",
  "schedule.full": "shift_lead",
  people: "gm",
  import: "shift_lead",
  reports: "gm",
  dashboard: "gm",
  settings: "gm",
};

/** Path prefixes guarded in middleware (longest match first). */
export const GUARDED_ROUTE_PREFIXES = [
  ["/checklist/manage", "checklists.manage"],
  ["/schedule/stations", "schedule.full"],
  ["/schedule/availability", "schedule.full"],
  ["/schedule/builder", "schedule.full"],
  ["/schedule/attendance", "schedule.full"],
  ["/schedule/timecards", "schedule.full"],
  ["/schedule/offers", "schedule.full"],
  ["/people", "people"],
  ["/import", "import"],
  ["/reports", "reports"],
  ["/dashboard", "dashboard"],
  ["/settings", "settings"],
];

export const FLASH_MESSAGES = {
  "access-denied": "You don't have access to that page.",
  "manager-required": "You don't have access to that page.",
};

/** @param {string | null | undefined} role */
export function normalizeRole(role) {
  const r = String(role || "crew").toLowerCase().replace(/[\s-]+/g, "_");
  if (r === "manager") return "shift_lead";
  if (r === "gm") return "gm";
  if (r === "assistant_manager" || r === "am") return "assistant_manager";
  if (r === "shift_lead") return "shift_lead";
  return "crew";
}

/** GM or assistant manager — shift drops/swaps and unscheduled-work PIN override. */
export function isGmOrAssistantManager(role) {
  const r = normalizeRole(role);
  return r === "gm" || r === "assistant_manager";
}

/** Punch corrections: GM / assistant manager only. Shift leads are read-only. */
export function canEditPunches(role) {
  return isGmOrAssistantManager(role);
}

/**
 * Drop / pickup / swap approval: GM or assistant manager only.
 * Shift leads cannot approve even if is_manager is set.
 * @param {string | { role?: string, is_assistant_manager?: boolean, is_manager?: boolean } | null | undefined} empOrRole
 */
export function canApproveOffers(empOrRole) {
  if (empOrRole && typeof empOrRole === "object") {
    const role = normalizeRole(empOrRole.role);
    if (role === "shift_lead") return false;
    if (isGmOrAssistantManager(role)) return true;
    if (empOrRole.is_assistant_manager) return true;
    if (empOrRole.is_manager) return true;
    return false;
  }
  return isGmOrAssistantManager(empOrRole);
}

/** @param {string | null | undefined} role */
export function isGm(role) {
  return normalizeRole(role) === "gm";
}

/** @param {string | null | undefined} role */
export function isShiftLeadOrAbove(role) {
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK.shift_lead;
}

/** @param {string | null | undefined} role @param {keyof typeof FEATURE_MIN_ROLE | string} feature */
export function canAccess(role, feature) {
  const minRole = FEATURE_MIN_ROLE[feature];
  if (!minRole) return false;
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK[minRole];
}

/** @param {string} pathname */
export function featureForPathname(pathname) {
  for (const [prefix, feature] of GUARDED_ROUTE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return feature;
    }
  }
  return null;
}
