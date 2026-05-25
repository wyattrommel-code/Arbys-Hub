export const STORE_ID = "07462";

export const SESSION_COOKIE = "hub_session";
export const SESSION_MAX_AGE_SEC = 15 * 60;

export const STORE_TIMEZONE = "America/Denver";

export const CHECKLIST_PHOTOS_BUCKET = "checklist-photos";

export const MANAGER_ROLES = new Set(["manager", "gm"]);

export const DAY_OF_WEEK_OPTIONS = [
  { value: "", label: "Every day" },
  { value: "0", label: "Sun" },
  { value: "1", label: "Mon" },
  { value: "2", label: "Tue" },
  { value: "3", label: "Wed" },
  { value: "4", label: "Thu" },
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
];

export const SHIFT_OPTIONS = ["AM", "PM", "BOTH"];

export const VERIFICATION_METHOD_OPTIONS = [
  { value: "checkbox", label: "Checkbox" },
  { value: "photo", label: "Photo" },
  { value: "photo_ai", label: "Photo+AI" },
];
