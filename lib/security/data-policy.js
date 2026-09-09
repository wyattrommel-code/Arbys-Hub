import schema from "./schema.json" with { type: "json" };

const rank = { crew: 0, shift_lead: 1, assistant_manager: 2, gm: 3 };
const rules = {
  employees: ["crew", "gm"], employee_wages: ["gm", "gm"],
  roles: ["crew", null], employee_roles: ["crew", null],
  roast_entries: ["crew", "crew"], sheet_tempering: ["crew", "crew"],
  hourly_sales: ["crew", "gm"], sales_logs: ["gm", "gm"],
  labor_logs: ["gm", "gm"], dt_logs: ["gm", "gm"],
  waste_items: ["crew", "gm"], waste_logs: ["crew", "crew"],
  inventory_items: ["crew", "gm"], inventory_logs: ["crew", "crew"],
  deployment_logs: ["crew", "shift_lead"], deployment_assignments: ["crew", "shift_lead"],
  station_certifications: ["crew", "gm"], station_questions: ["gm", "gm"],
  certification_attempts: ["gm", "gm"], training_sessions: ["gm", "gm"],
  schedule_shifts: ["crew", "shift_lead"], schedule_weeks: ["crew", "shift_lead"],
  schedule_templates: ["shift_lead", "shift_lead"], schedule_template_shifts: ["shift_lead", "shift_lead"],
  stations: ["crew", "shift_lead"], employee_availability: ["crew", "crew"],
  time_off_requests: ["crew", "crew"], shift_comparisons: ["gm", "gm"], employee_attendance: ["gm", "gm"],
  // These have dedicated endpoints which enforce workflow-specific authorization.
  time_punches: ["crew", null], break_punches: ["crew", null],
};
const employeeDirectory = "id,first_name,last_name,full_name,role,primary_role,is_active,status,is_trainer,is_shift_lead,is_assistant_manager,is_manager,jolt_employee_id,profile_photo_url,store_id".split(",");
const certificationDirectory = "id,employee_id,station,status,trainer_id,trainer_name,certified_date,store_id".split(",");
const readMethods = new Set(["GET", "HEAD"]);
export function forbidden(message = "Forbidden") {
  return Object.assign(new Error(message), { status: 403 });
}
function atLeast(actor, minimum) {
  return minimum != null && rank[actor?.role] != null && rank[actor.role] >= rank[minimum];
}
function columnsFor(table, actor) {
  if (table === "employees") {
    return atLeast(actor, "gm") ? schema.employees.filter((c) => c !== "employee_code") : employeeDirectory;
  }
  if (table === "station_certifications" && !atLeast(actor, "gm")) return certificationDirectory;
  return schema[table];
}
function selectColumns(input, table, actor) {
  const allowed = columnsFor(table, actor);
  const value = (input || "*").replace(/\s/g, "");
  if (value === "*") return allowed.join(",");
  // No arbitrary relationship embedding, aliases, casts, aggregates or computed fields.
  // The one relationship used by the app contains only non-sensitive role metadata.
  const joined = "id,employee_id,role_id,is_primary,roles(id,name,access_tier,color,is_active,sort_order)";
  if (table === "employee_roles" && value === joined) return joined;
  const selected = value.split(",");
  if (!selected.length || selected.some((c) => !allowed.includes(c))) throw forbidden("Column access denied");
  return value;
}

/** Convert an untrusted PostgREST request into an explicitly authorized request.
 * Scope filters are appended, never taken from the browser. No RPC or schema forwarding.
 */
export function authorizeDataRequest({ actor, table, method, search, body, prefer = "" }) {
  const rule = rules[table];
  const read = readMethods.has(method);
  if (!actor?.employee_id || !rule || !schema[table] || !["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) throw forbidden();
  if (!atLeast(actor, rule[read ? 0 : 1])) throw forbidden();
  const params = new URLSearchParams(search);
  for (const key of ["select", "limit", "offset", "order", "on_conflict"]) {
    if (params.getAll(key).length > 1) throw forbidden("Duplicate control parameter");
  }
  const allowedColumns = columnsFor(table, actor);
  for (const [key, value] of params) {
    if (["select", "limit", "offset", "on_conflict"].includes(key)) continue;
    if (key === "order") {
      if (value.split(",").some((part) => !allowedColumns.includes(part.split(".")[0]) || !/^[a-z_]+(?:\.(?:asc|desc|nullsfirst|nullslast))*$/.test(part))) throw forbidden();
      continue;
    }
    // Logical expressions and dotted keys could reach columns/relations outside this policy.
    if (!allowedColumns.includes(key) || !/^(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|not\.(?:eq|is|in))\./.test(value)) throw forbidden("Filter access denied");
  }
  for (const key of ["limit", "offset"]) {
    if (params.has(key) && !/^\d{1,7}$/.test(params.get(key))) throw forbidden();
  }
  if (params.has("on_conflict") && params.get("on_conflict").split(",").some((c) => !schema[table].includes(c))) throw forbidden();
  params.set("select", selectColumns(params.get("select"), table, actor));
  const hasStore = schema[table].includes("store_id");
  if (hasStore) params.append("store_id", "in.(07462,payson)");
  if (table === "employees") params.append("store_id", "eq.07462");
  if (table === "employees" && !atLeast(actor, "gm")) params.append("is_active", "eq.true");

  const own = ["employee_availability", "time_off_requests", "schedule_shifts", "time_punches", "break_punches"].includes(table) && !atLeast(actor, "shift_lead");
  if (own) params.append("employee_id", `eq.${actor.employee_id}`);
  if (!read && table === "waste_logs" && method !== "POST" && !atLeast(actor, "gm")) throw forbidden();
  if (!read && ["roast_entries", "sheet_tempering"].includes(table) && method === "DELETE" && !atLeast(actor, "gm")) throw forbidden();
  if (!read && ["PATCH", "DELETE"].includes(method)) {
    const original = new URLSearchParams(search);
    if (![...original.keys()].some((k) => schema[table].includes(k))) throw forbidden("A row filter is required");
  }
  const allowedPrefer = prefer.split(",").map((v) => v.trim()).filter(Boolean);
  if (allowedPrefer.some((v) => !/^(?:return=(?:minimal|representation)|resolution=(?:merge|ignore)-duplicates|count=(?:exact|planned|estimated)|missing=default)$/.test(v))) throw forbidden();
  let rows = body == null ? null : (Array.isArray(body) ? body : [body]);
  if (!read && method !== "DELETE" && (!rows?.length || rows.length > 5000)) throw forbidden("Invalid batch");
  if (read && body != null) throw forbidden();
  if (rows) rows = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw forbidden();
    if (Object.keys(row).some((c) => !schema[table].includes(c))) throw forbidden("Unknown write column");
    const next = { ...row };
    if (hasStore && next.store_id != null && !["07462", "payson"].includes(next.store_id)) throw forbidden("Store access denied");
    if (table === "employees" && next.store_id != null && next.store_id !== "07462") throw forbidden();
    if (hasStore && method === "POST" && next.store_id == null) next.store_id = ["employees", "inventory_items", "inventory_logs", "station_certifications"].includes(table) ? "07462" : "payson";
    if (own) {
      if (next.employee_id != null && next.employee_id !== actor.employee_id) throw forbidden();
      next.employee_id = actor.employee_id;
      if ("employee_name" in next) next.employee_name = `${actor.first_name} ${actor.last_name}`.trim();
      // Do not let an upsert use another employee's primary key to take over their row.
      if (next.id != null || (params.has("on_conflict") && params.get("on_conflict") !== "employee_id,day_of_week")) throw forbidden();
    }
    if (table === "time_off_requests") {
      if (method === "POST") {
        if (params.has("on_conflict") || allowedPrefer.some((v) => v.startsWith("resolution="))) throw forbidden();
        if (Object.keys(next).some((c) => !["employee_id", "employee_name", "start_date", "end_date", "reason", "status", "store_id"].includes(c))) throw forbidden();
        next.employee_id = actor.employee_id;
        next.employee_name = `${actor.first_name} ${actor.last_name}`.trim();
        next.status = "pending";
      } else {
        if (!atLeast(actor, "shift_lead") || method !== "PATCH" || Object.keys(next).some((c) => !["status", "reviewed_by", "reviewed_at"].includes(c)) || !["approved", "denied"].includes(next.status)) throw forbidden();
        next.reviewed_by = `${actor.first_name} ${actor.last_name}`.trim();
        next.reviewed_at = new Date().toISOString();
      }
    }
    if (table === "employee_availability" && Object.keys(next).some((c) => !["employee_id", "employee_name", "day_of_week", "is_available", "available_start", "available_end", "updated_at"].includes(c))) throw forbidden();
    if (table === "employees" && "employee_code" in next && !/^\d{4}$/.test(String(next.employee_code))) throw forbidden("PIN must be four digits");
    if (table === "employee_wages") next.approved_by = `${actor.first_name} ${actor.last_name}`.trim();
    if ("submitted_by" in next) next.submitted_by = `${actor.first_name} ${actor.last_name}`.trim();
    return next;
  });
  if (!read && table === "time_off_requests" && method === "DELETE") throw forbidden();
  return { params, body: rows == null ? null : Array.isArray(body) ? rows : rows[0], prefer: allowedPrefer.join(","), own };
}
