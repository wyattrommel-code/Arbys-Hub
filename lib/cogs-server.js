import "server-only";
import { buildCogsDashboard, normalizeCostRow } from "./cogs";
import { getSupabaseServer } from "./supabase-server";

async function rows(table) {
  const { data, error } = await getSupabaseServer().from(table).select("*");
  if (error) throw error;
  return data || [];
}

export async function loadCogsDashboard() {
  const [invoices, lines, costs, windows] = await Promise.all([
    rows("cogs_invoices"),
    rows("cogs_invoice_lines"),
    rows("cogs_item_cost"),
    rows("cogs_windows"),
  ]);
  return buildCogsDashboard({ invoices, lines, costs, windows });
}

export async function loadCogsCosts(kind, requestedItemIds) {
  const requested = new Set(requestedItemIds.map(String));
  if (!requested.size) return { costs: [], mappings: [] };
  const mappings = (await rows("cogs_item_mappings")).filter((row) => row.target_type === kind
    && row.is_verified === true && requested.has(String(row.target_item_id)));
  const keys = new Set(mappings.map((row) => `${row.supplier_sku}|${row.supplier_uom}|${row.price_basis}|${row.price_uom}`));
  const costs = (await rows("cogs_item_cost")).map(normalizeCostRow).filter((row) =>
    keys.has(`${row.sku}|${row.purchase_uom}|${row.price_basis}|${row.price_uom}`));
  return { costs, mappings };
}
