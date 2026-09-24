"use client";

import { useCallback, useEffect, useState } from "react";

const money = (value) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value) => value == null ? "—" : `${Number(value).toFixed(2)}%`;
const date = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : "—";

function Card({ label, value, detail }) {
  return <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
    <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    {detail ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p> : null}
  </div>;
}

function Empty({ children }) {
  return <p className="p-5 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}

export default function CogsPage() {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const load = useCallback(async () => {
    setState({ loading: true, error: "", data: null });
    try {
      const response = await fetch("/api/cogs", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load COGS data.");
      setState({ loading: false, error: "", data: json });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Could not load COGS data.", data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <div className="p-6 text-sm text-zinc-500">Loading purchase proxy metrics…</div>;
  if (state.error) return <div className="mx-auto w-full max-w-7xl p-6"><div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"><p className="font-semibold">COGS data unavailable</p><p className="mt-1 text-sm">{state.error}</p><button onClick={load} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold dark:bg-red-950">Retry</button></div></div>;

  const data = state.data;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
    <header>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">McLane COGS</h1>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold tracking-wide text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">PROXY</span>
      </div>
      <p className="mt-2 max-w-4xl text-sm text-zinc-600 dark:text-zinc-400">{data.methodology}</p>
    </header>

    {data.incomplete_window_count > 0 ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><strong>Incomplete coverage:</strong> {data.incomplete_window_count} delivery window{data.incomplete_window_count === 1 ? " is" : "s are"} open or missing source sales days. Missing values are shown as —, never as zero.</div> : null}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Source summary">
      <Card label="Parsed invoices" value={data.summary.parsed_invoice_count} detail="Validated McLane source PDFs" />
      <Card label="FOOD purchases" value={money(data.summary.food_total)} detail="Signed FOOD line spend" />
      <Card label="Fees / non-food" value={money(data.summary.fee_non_food_total)} detail="Excluded from FOOD proxy cost" />
      <Card label="Source freshness" value={data.summary.source_freshness ? date(data.summary.source_freshness) : "—"} detail={`Parser: ${data.summary.parser_versions.join(", ") || "—"}`} />
    </section>

    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800"><h2 className="font-bold">Delivery-window metrics <span className="text-amber-700 dark:text-amber-400">(PROXY)</span></h2><p className="mt-1 text-xs text-zinc-500">Closed orders / transactions are not a people guest count. Food $ / guest is only shown when an authoritative guest count exists.</p></div>
      {data.windows.length === 0 ? <Empty>No delivery windows have been imported.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-950/50"><tr><th className="p-3">Window</th><th className="p-3">Coverage</th><th className="p-3 text-right">FOOD</th><th className="p-3 text-right">Net sales</th><th className="p-3 text-right">Food % PROXY</th><th className="p-3 text-right">People guests</th><th className="p-3 text-right">Food $ / guest PROXY</th><th className="p-3 text-right">Closed orders</th><th className="p-3">Status</th></tr></thead><tbody>{data.windows.map((row) => <tr key={row.id} className="border-t border-zinc-100 align-top dark:border-zinc-800"><td className="p-3 font-medium">{date(row.start_date)} – {row.end_date ? date(row.end_date) : "Open"}<div className="text-xs font-normal text-zinc-500">{row.invoice_count} invoice{row.invoice_count === 1 ? "" : "s"}</div></td><td className="p-3">{row.coverage_start ? `${date(row.coverage_start)} – ${date(row.coverage_end)}` : "No sales days"}<div className="text-xs text-zinc-500">{row.covered_sales_days} / {row.expected_sales_days ?? "?"} days</div></td><td className="p-3 text-right tabular-nums">{money(row.food_total)}</td><td className="p-3 text-right tabular-nums">{money(row.net_sales)}</td><td className="p-3 text-right font-semibold tabular-nums">{percent(row.food_percent_proxy)}</td><td className="p-3 text-right tabular-nums">{row.guest_count ?? "—"}</td><td className="p-3 text-right font-semibold tabular-nums">{money(row.food_per_guest_proxy)}</td><td className="p-3 text-right tabular-nums">{row.closed_orders ?? "—"}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.is_complete ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"}`}>{row.is_complete ? "Complete" : row.is_open ? "Open" : "Incomplete"}</span><p className="mt-2 max-w-xs text-xs text-zinc-500">{row.warning}</p></td></tr>)}</tbody></table></div>}
    </section>

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"><div className="border-b border-zinc-200 p-4 dark:border-zinc-800"><h2 className="font-bold">Top 10 FOOD SKUs</h2><p className="text-xs text-zinc-500">Ranked by {data.top_sku_ranking_basis.toLowerCase()}.</p></div>{data.top_food_skus.length === 0 ? <Empty>No FOOD lines are available.</Empty> : <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">SKU / item</th><th className="p-3 text-right">Spend</th></tr></thead><tbody>{data.top_food_skus.map((row) => <tr key={row.sku} className="border-t border-zinc-100 dark:border-zinc-800"><td className="p-3"><span className="font-mono font-semibold">{row.sku}</span><div className="text-xs text-zinc-500">{row.description}</div></td><td className="p-3 text-right font-semibold tabular-nums">{money(row.spend)}</td></tr>)}</tbody></table>}</section>
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"><div className="border-b border-zinc-200 p-4 dark:border-zinc-800"><h2 className="font-bold">Purchase-unit price changes</h2><p className="text-xs text-zinc-500">Observed FOOD purchase prices only; no serving yields are inferred.</p></div>{data.price_changes.length === 0 ? <Empty>No changed purchase-unit prices are available.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">SKU</th><th className="p-3">Purchase basis</th><th className="p-3 text-right">Old</th><th className="p-3 text-right">New</th><th className="p-3 text-right">Change</th></tr></thead><tbody>{data.price_changes.map((row) => <tr key={row.sku} className="border-t border-zinc-100 dark:border-zinc-800"><td className="p-3"><span className="font-mono font-semibold">{row.sku}</span><div className="text-xs text-zinc-500">{row.description}</div></td><td className="p-3">per {row.price_uom || row.purchase_uom || "purchase unit"}{row.price_basis === "catch_weight" ? " (catch weight)" : ""}</td><td className="p-3 text-right tabular-nums">{money(row.prior_purchase_unit_cost)}</td><td className="p-3 text-right font-semibold tabular-nums">{money(row.current_purchase_unit_cost)}</td><td className={`p-3 text-right font-semibold tabular-nums ${row.change_percent > 0 ? "text-red-600" : "text-emerald-700"}`}>{row.change_percent > 0 ? "+" : ""}{percent(row.change_percent)}</td></tr>)}</tbody></table></div>}</section>
    </div>
  </div>;
}
