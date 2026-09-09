"use client";
import { useEffect, useState } from "react";
import { getStoreToday, formatStoreDateTime } from "@/lib/store-time";
const dollars = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
export default function BrinkSalesImport() {
  const [date, setDate] = useState(getStoreToday);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    fetch(`/api/integrations/brink?date=${date}`, { signal: controller.signal }).then(async (r) => {
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setData(result);
    }).catch((err) => { if (err.name !== "AbortError") setError(err.message || "Could not load PAR status."); });
    return () => controller.abort();
  }, [date]);
  async function sync() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/integrations/brink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (err) { setError(err.message || "Could not sync PAR sales."); }
    finally { setBusy(false); }
  }
  const orders = data?.day?.orders?.filter((o) => o.items.length || o.total !== 0) || [];
  return <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-bold text-[#C8102E]">PAR POS · Connected Sales</h3>
      {data && <span className={`rounded-full px-3 py-1 text-xs font-bold ${data.environment === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}`}>{data.environment === "sandbox" ? "SANDBOX · TEST SALES" : "PRODUCTION"}</span>}
    </div>
    <p className="mt-2 text-sm text-gray-600">{data?.label || "PAR connection"} · Import orders directly from your register.</p>
    {data?.environment === "sandbox" && <p className="mt-2 text-sm text-amber-800">Test sales are kept separate from store totals and forecasts.</p>}
    {data?.environment === "production" && <p className="mt-2 text-sm text-gray-600">{data.publishing ? "Sync replaces this date’s hourly store sales with PAR totals." : "Review mode: imported orders are separate from store totals."}</p>}
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium">Business date<input type="date" value={date} max={getStoreToday()} disabled={busy} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} className="mt-1 block rounded-md border border-gray-300 px-3 py-2" /></label>
      <button type="button" disabled={busy || !data?.configured} onClick={sync} className="rounded-md bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Syncing sales…" : "Sync sales"}</button>
    </div>
    {data && !data.configured && <p className="mt-3 text-sm text-amber-800">Connection setup is pending. Server credentials must be installed before syncing.</p>}
    <p className="mt-3 text-xs text-gray-500">{data?.scheduled ? "Daily sync enabled: imports the previous business day each morning." : "Daily sync is not enabled."} Re-syncing updates existing orders without duplicates.</p>
    {data?.state?.last_success_at && <p className="mt-1 text-xs text-gray-500">Last successful connection: {formatStoreDateTime(data.state.last_success_at)}</p>}
    {(error || data?.state?.last_error) && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error || data.state.last_error}</p>}
    {data?.day ? <>
      <p className="mt-4 font-semibold">{data.day.summary.closed_orders} closed orders · Net sales {dollars(data.day.summary.net_sales)} · Tax {dollars(data.day.summary.tax)} · Total {dollars(data.day.summary.total)}</p>
      <p className="mt-1 text-xs text-gray-500">{data.day.summary.open_orders} open orders (excluded from totals). Snapshot: {formatStoreDateTime(data.day.synced_at)}</p>
      <div className="mt-3 max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-gray-500"><th className="py-2 pr-3">Order</th><th className="pr-3">Items</th><th className="pr-3">Status</th><th className="text-right">Total</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b"><td className="py-3 pr-3">#{order.number}</td><td className="pr-3">{order.items.map((item) => `${item.description}${item.voided || item.deleted || item.cleared ? " (removed)" : ""}`).join(", ")}</td><td className="pr-3">{order.refund ? "Refund" : order.closed ? "Closed" : "Open"}</td><td className="text-right">{dollars(order.total)}</td></tr>)}</tbody></table></div>
    </> : data?.configured && <p className="mt-4 text-sm text-gray-500">No saved API sales for this date. Select Sync sales to read the register.</p>}
  </section>;
}
