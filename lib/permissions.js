/** @typedef {'crew' | 'shift_lead' | 'gm'} HubRole */

const ROLE_RANK = {
  crew: 0,
  shift_lead: 1,
  gm: 2,
};

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
  const r = String(role || "crew").toLowerCase();
  if (r === "manager") return "shift_lead";
  if (r === "gm") return "gm";
  if (r === "shift_lead") return "shift_lead";
  return "crew";
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
