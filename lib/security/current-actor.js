import { getEffectiveAccess } from "../roles.js";
/** Never authorize from the role stored in an old cookie. Fail closed on lookup errors. */
export async function currentActor(supabase, session) {
  if (!session?.employee_id) return null;
  const { data: row, error } = await supabase.from("employees")
    .select("id,first_name,last_name,is_active,status,store_id")
    .eq("id", session.employee_id).eq("store_id", "07462").maybeSingle();
  if (error) throw error;
  if (!row || !row.is_active || ["inactive", "terminated"].includes(row.status)) return null;
  const access = await getEffectiveAccess(supabase, row.id);
  if (access === "none") return null;
  return { ...session, first_name: row.first_name, last_name: row.last_name, role: access, access_tier: access };
}
