/** @typedef {'gm' | 'assistant_manager' | 'shift_lead' | 'crew' | 'none'} AccessTier */

const ACCESS_TIER_RANK = {
  none: 0,
  crew: 1,
  shift_lead: 2,
  assistant_manager: 3,
  gm: 4,
};

export const ACCESS_TIER_OPTIONS = [
  { value: "none", label: "None (scheduling only)" },
  { value: "crew", label: "Crew" },
  { value: "shift_lead", label: "Shift Lead" },
  { value: "assistant_manager", label: "Assistant Manager" },
  { value: "gm", label: "GM" },
];

export const ACCESS_TIER_BADGE_LABELS = {
  none: "Crew",
  crew: "Crew",
  shift_lead: "Shift Lead",
  assistant_manager: "Assistant Manager",
  gm: "GM",
};

/** @param {string | null | undefined} tier */
export function normalizeAccessTier(tier) {
  const t = String(tier || "none")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (t === "gm") return "gm";
  if (t === "assistant_manager" || t === "am") return "assistant_manager";
  if (t === "shift_lead") return "shift_lead";
  if (t === "crew") return "crew";
  return "none";
}

/** Hub session/feature checks have no `none` — scheduling-only roles count as crew. */
export function hubRoleFromAccessTier(tier) {
  const t = normalizeAccessTier(tier);
  return t === "none" ? "crew" : t;
}

/** @param {string | null | undefined} tier */
export function isPrivilegedAccessTier(tier) {
  const t = normalizeAccessTier(tier);
  return t === "gm" || t === "assistant_manager";
}

/** @param {Iterable<string | null | undefined>} tiers */
export function highestAccessTier(tiers) {
  let best = "none";
  let bestRank = ACCESS_TIER_RANK.none;
  for (const raw of tiers || []) {
    const t = normalizeAccessTier(raw);
    const rank = ACCESS_TIER_RANK[t] ?? 0;
    if (rank > bestRank) {
      best = t;
      bestRank = rank;
    }
  }
  return best;
}

/** Derived employee columns. JOIN table remains source of truth. */
export function mirrorFieldsFromAccess(tier, primaryRoleName) {
  const hub = hubRoleFromAccessTier(tier);
  return {
    role: hub,
    primary_role: primaryRoleName || null,
    is_manager: hub === "gm",
    is_assistant_manager: hub === "assistant_manager",
    is_shift_lead: hub === "shift_lead" || hub === "assistant_manager" || hub === "gm",
  };
}

export function accessTierLabel(tier) {
  return ACCESS_TIER_BADGE_LABELS[normalizeAccessTier(tier)] || "Crew";
}

export function defaultRoleForNewEmployee(roles) {
  const active = (roles || []).filter((r) => r?.is_active !== false);
  return (
    active.find((r) => normalizeAccessTier(r.access_tier) === "crew") ||
    active.find((r) => normalizeAccessTier(r.access_tier) === "none") ||
    active[0] ||
    null
  );
}
