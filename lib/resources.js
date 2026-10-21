export const RESOURCE_CATEGORIES = [
  { value: "equipment", label: "Equipment", description: "Manuals, maintenance, cleaning, and repairs", icon: "wrench" },
  { value: "training", label: "Training", description: "Learner Hub, onboarding, and station training", icon: "graduation" },
  { value: "operations", label: "Operations", description: "Opening, closing, service, and daily procedures", icon: "clipboard" },
  { value: "food_menu", label: "Food & Menu", description: "Builds, prep, portions, and limited-time offers", icon: "utensils" },
  { value: "safety_cleaning", label: "Safety & Cleaning", description: "Food safety, sanitation, and emergency guides", icon: "shield" },
  { value: "policies_contacts", label: "Policies & Contacts", description: "Handbooks, store policies, forms, and contacts", icon: "folder" },
];
export const RESOURCE_TAGS = ["SOP", "Schedule", "Manual", "Video", "Form", "Checklist", "Guide", "Learner Hub"];
export const RESOURCE_CATEGORY_ICONS = ["wrench", "graduation", "clipboard", "utensils", "shield", "folder", "book"];
export const MAX_RESOURCE_CATEGORIES = 30;

export const RESOURCE_BUCKET = "hub-resources";
export const MAX_RESOURCE_FILE_BYTES = 4 * 1024 * 1024;
export const RESOURCE_FILE_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
export const RESOURCE_FILE_ACCEPT = Object.keys(RESOURCE_FILE_TYPES).map((ext) => `.${ext}`).join(",");

export function resourceError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function resourceCategory(value, categories = RESOURCE_CATEGORIES) {
  return categories.find((category) => category.value === value) || { value, label: "Uncategorized", icon: "folder", description: "" };
}

export function normalizeResourceTags(tags = []) {
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) throw resourceError("Tags must be a list of names.");
  const unique = new Map();
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 32) throw resourceError("Keep each tag to 32 characters or fewer.");
    if (/[\x00-\x1f\x7f]/.test(tag)) throw resourceError("Invalid tag name.");
    const key = tag.toLowerCase();
    if (!unique.has(key)) unique.set(key, RESOURCE_TAGS.find((preset) => preset.toLowerCase() === key) || tag);
  }
  if (unique.size > 12) throw resourceError("Use up to 12 tags per resource.");
  return [...unique.values()];
}

export function validateResourceCategories(categories) {
  if (!Array.isArray(categories) || !categories.length || categories.length > MAX_RESOURCE_CATEGORIES) throw resourceError(`Use between 1 and ${MAX_RESOURCE_CATEGORIES} tabs.`);
  const keys = new Set();
  const names = new Set();
  return categories.map((category) => {
    if (!category || typeof category !== "object" || typeof category.value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(category.value)) throw resourceError("Invalid tab. Reload the database and try again.");
    const label = typeof category.label === "string" ? category.label.trim().replace(/\s+/g, " ") : "";
    const description = typeof category.description === "string" ? category.description.trim() : "";
    if (!label || label.length > 60) throw resourceError("Give each tab a name of 1–60 characters.");
    if (description.length > 160) throw resourceError("Keep each tab description to 160 characters or fewer.");
    if (!RESOURCE_CATEGORY_ICONS.includes(category.icon)) throw resourceError("Choose a valid tab icon.");
    if (keys.has(category.value) || names.has(label.toLowerCase())) throw resourceError("Each tab needs a unique name.");
    keys.add(category.value); names.add(label.toLowerCase());
    return { value: category.value, label, description, icon: category.icon };
  });
}

export function validateResource(input, categories = RESOURCE_CATEGORIES) {
  function field(name, max) {
    if (input[name] != null && typeof input[name] !== "string") throw resourceError(`Invalid ${name}.`);
    const value = (input[name] || "").trim();
    if (value.length > max) throw resourceError(`${name === "url" ? "Link" : name[0].toUpperCase() + name.slice(1)} is too long (maximum ${max} characters).`);
    return value;
  }
  const title = field("title", 160);
  if (!title) throw resourceError("Give this resource a title.");
  if (!categories.some((category) => category.value === input.category)) throw resourceError("Choose a tab in this store's library.");
  if (!["team", "managers"].includes(input.visibility)) throw resourceError("Choose who can view this resource.");
  if (typeof input.pinned !== "boolean") throw resourceError("Invalid pin setting.");
  const url = field("url", 2000);
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw resourceError("Enter a complete https:// or http:// link."); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw resourceError("Use an http:// or https:// link without a username or password.");
    }
  }
  return { title, category: input.category, summary: field("summary", 500), notes: field("notes", 30000), url, visibility: input.visibility, pinned: input.pinned, tags: normalizeResourceTags(input.tags) };
}

export function validateResourceFile(file) {
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") throw resourceError("Choose a file to upload.");
  if (!file.size) throw resourceError("The selected file is empty.");
  if (file.size > MAX_RESOURCE_FILE_BYTES) throw resourceError("Files must be 4 MB or smaller. Use a link for larger files.");
  const name = String(file.name || "").replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(-180);
  const extension = name.split(".").at(-1).toLowerCase();
  if (!RESOURCE_FILE_TYPES[extension]) throw resourceError("Use a PDF, Office document, text file, spreadsheet, or JPG, PNG, or WebP image.");
  return { name, extension, type: RESOURCE_FILE_TYPES[extension], size: file.size };
}

export function filterResources(resources, { category = "all", search = "", pinnedOnly = false, sort = "recent", tag = "all", categories = RESOURCE_CATEGORIES } = {}) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return resources.filter((resource) => {
    if (category !== "all" && resource.category !== category) return false;
    if (pinnedOnly && !resource.pinned) return false;
    if (tag !== "all" && !(resource.tags || []).some((value) => value.toLowerCase() === tag.toLowerCase())) return false;
    const text = [resource.title, resource.summary, resource.notes, resource.file_name, resource.url, ...(resource.tags || []), resourceCategory(resource.category, categories).label].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "title") return a.title.localeCompare(b.title);
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
}

export function formatResourceSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
