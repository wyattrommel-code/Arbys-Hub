const buckets = new Set(["profile-photos", "punch-photos", "checklist-photos"]);
export function privatePhotoUrl(value) {
  if (typeof value !== "string") return value;
  const match = value.match(/^https:\/\/[^/]+\/storage\/v1\/object\/public\/([^/]+)\/([^?#]+)(?:\?[^#]*)?$/);
  if (!match || !buckets.has(match[1])) return value;
  return `/api/photos/${match[1]}/${match[2]}`;
}
export function protectPhotoUrls(value) {
  if (Array.isArray(value)) return value.map(protectPhotoUrls);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, protectPhotoUrls(v)]));
  return privatePhotoUrl(value);
}
