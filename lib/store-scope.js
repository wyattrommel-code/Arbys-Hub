import { resourceError } from "./resources.js";

export function authorizedStoreId(employee) {
  if (employee?.store_verified !== true || typeof employee.store_id !== "string" || !employee.store_id) {
    throw resourceError("Your store access could not be verified. Please sign in again.", 403);
  }
  return employee.store_id;
}

/** Areas with verified multi-store queries. Other Hub modules remain store-local. */
export function supportsScopedStore(pathname) {
  return ["/database", "/checklist", "/api/resources", "/api/equipment", "/api/stores", "/api/checklist", "/api/photos/checklist-photos"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
