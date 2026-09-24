const numberOrNull = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const first = (row, keys) => {
  for (const key of keys) if (row?.[key] != null) return row[key];
  return null;
};

const dateValue = (row, keys) => {
  const value = first(row, keys);
  return value == null ? null : String(value);
};

export function normalizeCostRow(row) {
  const sku = first(row, ["sku", "item_sku"]);
  const current = numberOrNull(first(row, ["current_purchase_unit_cost", "current_unit_price", "latest_unit_price", "unit_price"]));
  const previous = numberOrNull(first(row, ["prior_purchase_unit_cost", "previous_purchase_unit_cost", "prior_unit_price", "previous_unit_price"]));
  return {
    sku: sku == null ? null : String(sku),
    description: String(first(row, ["description", "item_description"]) || ""),
    purchase_uom: String(first(row, ["purchase_uom", "uom"]) || "").toUpperCase(),
    price_basis: String(first(row, ["price_basis"]) || "shipped_unit"),
    price_uom: String(first(row, ["price_uom", "purchase_uom", "uom"]) || "").toUpperCase(),
    current_purchase_unit_cost: current,
    prior_purchase_unit_cost: previous,
    current_observed_at: dateValue(row, ["current_observed_at", "latest_observed_at", "latest_delivery_date", "last_delivery_date", "observed_at", "refreshed_at", "updated_at"]),
    prior_observed_at: dateValue(row, ["prior_observed_at", "previous_observed_at", "prior_delivery_date"]),
    change_percent: previous != null && previous !== 0 && current != null ? ((current - previous) / previous) * 100 : null,
  };
}

function normalizeWindow(row) {
  const food = numberOrNull(first(row, ["food_total", "food_purchases"]));
  const sales = numberOrNull(first(row, ["net_sales", "covered_net_sales"]));
  const guests = numberOrNull(first(row, ["guest_count", "covered_guest_count"]));
  const closedOrders = numberOrNull(first(row, ["closed_orders", "transaction_count", "covered_closed_orders"]));
  const expectedDays = numberOrNull(first(row, ["expected_sales_days", "expected_day_count"]));
  const coveredDays = numberOrNull(first(row, ["covered_sales_days", "covered_day_count"]));
  const isOpen = !first(row, ["end_date", "window_end"]);
  const isComplete = row?.is_complete === true && !isOpen && expectedDays != null && coveredDays === expectedDays;
  return {
    id: first(row, ["id", "start_date", "window_start"]),
    start_date: dateValue(row, ["start_date", "window_start"]),
    end_date: dateValue(row, ["end_date", "window_end"]),
    invoice_count: numberOrNull(row?.invoice_count) || 0,
    food_total: food || 0,
    expected_sales_days: expectedDays,
    covered_sales_days: coveredDays || 0,
    coverage_start: dateValue(row, ["coverage_start", "sales_coverage_start"]),
    coverage_end: dateValue(row, ["coverage_end", "sales_coverage_end"]),
    net_sales: sales,
    guest_count: guests,
    closed_orders: closedOrders,
    food_percent_proxy: sales != null && sales > 0 && food != null ? (food / sales) * 100 : null,
    food_per_guest_proxy: guests != null && guests > 0 && food != null ? food / guests : null,
    food_per_closed_order_proxy: closedOrders != null && closedOrders > 0 && food != null ? food / closedOrders : null,
    is_open: isOpen,
    is_complete: isComplete,
    warning: String(row?.warning || (isOpen ? "Open delivery window; later sales and the next delivery are not yet available." : !isComplete ? "Incomplete source coverage; proxy values use covered days only." : "Closed delivery window with complete source-day coverage.")),
  };
}

/** Build the API representation without turning missing source values into zeroes. */
export function buildCogsDashboard({ invoices = [], lines = [], costs = [], windows = [] }) {
  const foodTotal = invoices.reduce((sum, row) => sum + (numberOrNull(row.food_total) || 0), 0);
  const nonFoodTotal = invoices.reduce((sum, row) => sum + (numberOrNull(first(row, ["non_food_total", "fee_non_food_total"])) || 0), 0);
  const bySku = new Map();
  for (const line of lines) {
    const category = String(line.category || "").toUpperCase();
    if (!(line.is_food === true || category === "FOOD")) continue;
    const sku = String(first(line, ["sku", "item_sku"]) || "");
    if (!sku) continue;
    const current = bySku.get(sku) || { sku, description: String(line.description || ""), spend: 0, purchase_units: 0 };
    current.spend += numberOrNull(first(line, ["extended_amount", "line_total"])) || 0;
    current.purchase_units += numberOrNull(first(line, ["shipped_quantity", "quantity"])) || 0;
    bySku.set(sku, current);
  }
  const normalizedCosts = costs.map(normalizeCostRow).filter((row) => row.sku && row.current_purchase_unit_cost != null);
  const priceChanges = normalizedCosts
    .filter((row) => row.prior_purchase_unit_cost != null && row.current_purchase_unit_cost !== row.prior_purchase_unit_cost)
    .sort((a, b) => Math.abs(b.change_percent || 0) - Math.abs(a.change_percent || 0));
  const normalizedWindows = windows.map(normalizeWindow).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const freshness = invoices.map((row) => dateValue(row, ["imported_at", "created_at", "updated_at"])).filter(Boolean).sort().at(-1) || null;
  const parserVersions = [...new Set(invoices.map((row) => row.parser_version).filter(Boolean))].sort();
  return {
    metric_label: "PROXY",
    methodology: "FOOD purchases are attributed to delivery windows. These are purchase proxies, not actual or theoretical COGS; inventory change, recipes, serving portions, and yields are not inferred.",
    summary: {
      parsed_invoice_count: invoices.length,
      food_total: foodTotal,
      fee_non_food_total: nonFoodTotal,
      source_freshness: freshness,
      parser_versions: parserVersions,
    },
    windows: normalizedWindows,
    incomplete_window_count: normalizedWindows.filter((row) => !row.is_complete).length,
    top_food_skus: [...bySku.values()].sort((a, b) => b.spend - a.spend).slice(0, 10),
    top_sku_ranking_basis: "FOOD purchase spend (signed extended amount)",
    price_changes: priceChanges,
  };
}

const normalizeUom = (value) => String(value || "").trim().toUpperCase().replace(/^CASE$/, "CS").replace(/^EACH$/, "EA");
/**
 * Apply costs only through verified rows from cogs_item_mappings. Weight-priced
 * observations require an explicit multiplier and can never silently become a
 * case or count-unit cost. Item names and ad-hoc item columns are not mappings.
 */
export function linkItemCosts(items, costRows, kind, mappings = []) {
  const costs = new Map(costRows.map(normalizeCostRow).filter((row) => row.sku).map((row) => [
    `${row.sku}|${normalizeUom(row.purchase_uom)}|${row.price_basis}|${normalizeUom(row.price_uom)}`, row,
  ]));
  const mapped = new Map(mappings.filter((row) => row.target_type === kind && row.is_verified === true)
    .map((row) => [String(row.target_item_id), row]));
  return items.map((item) => {
    const mapping = mapped.get(String(item.id));
    if (!mapping) return item;
    const key = `${mapping.supplier_sku}|${normalizeUom(mapping.supplier_uom)}|${mapping.price_basis}|${normalizeUom(mapping.price_uom)}`;
    const cost = costs.get(key);
    if (!cost || cost.current_purchase_unit_cost == null) return item;
    const direct = cost.price_basis === "shipped_unit"
      && normalizeUom(mapping.target_uom) === normalizeUom(cost.price_uom);
    const configuredMultiplier = numberOrNull(mapping.cost_multiplier);
    const multiplier = configuredMultiplier ?? (direct ? 1 : null);
    if (multiplier == null || multiplier <= 0) return item;
    const targetCost = cost.current_purchase_unit_cost * multiplier;
    const metadata = { cost_source: `McLane FOOD purchase history (${mapping.verification_source})`, cost_as_of: cost.current_observed_at, cost_sku: cost.sku, cost_purchase_uom: cost.price_uom, cost_mapping_version: mapping.mapping_version };
    if (kind === "inventory") {
      const bags = numberOrNull(item.bags_per_case);
      return {
        ...item,
        case_wholesale_cost: targetCost,
        ...(bags != null && bags > 0 ? { bag_wholesale_cost: targetCost / bags } : {}),
        ...metadata,
      };
    }
    if (kind === "waste") {
      return { ...item, unit_wholesale_cost: targetCost, ...metadata };
    }
    return item;
  });
}

export function explicitCostSkus(items) {
  return [];
}
