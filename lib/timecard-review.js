import { addDaysISO } from "./store-time";

// Payson's Jolt pay periods: Sunday Aug 30 through Saturday Sep 12, 2026.
export function payPeriodFor(date) {
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse("2026-08-30T00:00:00Z")) / 86400000);
  const start = addDaysISO("2026-08-30", Math.floor(days / 14) * 14);
  return { from: start, to: addDaysISO(start, 13) };
}

export function matchesPunchReview(punch, filter) {
  if (filter === "open") return Boolean(punch.open);
  if (filter === "unscheduled") return Boolean(punch.unscheduled);
  if (filter === "edited") return Boolean(punch.edited);
  if (filter === "photo") return Boolean((punch.clock_in_photo_url && !punch.face_detected_in) || (punch.clock_out_photo_url && !punch.face_detected_out));
  return true;
}

export function filterTimecardGroups(groups, search, filter) {
  const query = search.trim().toLowerCase();
  return groups.filter((group) => group.name.toLowerCase().includes(query))
    .map((group) => ({ ...group, punches: group.punches.filter((punch) => matchesPunchReview(punch, filter)) }))
    .filter((group) => group.punches.length);
}
