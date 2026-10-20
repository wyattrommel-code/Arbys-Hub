"use client";
import { useState } from "react";
import { salesReports, REPORT_CATEGORIES } from "@/lib/brink-sales-reports";
import { formatStoreDateTime } from "@/lib/store-time";
const money = n => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(n);
const person = (name,id) => name ? `${name} · POS ${id}` : id ? `POS ${id}` : "Not provided";
const time = value => value ? formatStoreDateTime(value) : "Not provided";
const tabs = {employee_meal:"Employee meals",manager_meal:"Manager meals",discounts:"All discounts / promotions",voids:"Voids / removed items"};
export default function BrinkSalesReports({status}) {
  const [tab,setTab] = useState("employee_meal");
  const [query,setQuery] = useState("");
  const [removalType,setRemovalType] = useState("voided");
  const report = salesReports(status);
  const matches = row => !query.trim() || [row.receipt,row.employee_name,row.employee_id,row.name,row.item,row.applied_by,row.applied_by_id,row.approved_by,row.approved_by_id,row.voided_by,row.reason].some(v=>String(v || "").toLowerCase().includes(query.trim().toLowerCase()));
  const adjustments = report.adjustments.filter(a=>tab === "discounts" || a.category === tab).filter(matches);
  const removals = report.removals.filter(r=>removalType === "all" || r[removalType]).filter(matches);
  const coverage = report.coverage;
  return <section className="mt-6 border-t pt-5" aria-label="PAR sales reports">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-lg font-bold">Meals, discounts and voids</h3><p className="text-sm text-gray-600">Business date {status.business_date} · Saved PAR records</p></div>
      <a className="text-sm font-semibold text-[#C8102E] underline" href={`/api/integrations/brink?date=${status.business_date}&export=reports`}>Download all reports (JSON)</a>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {["employee_meal","manager_meal"].map(key=><div key={key} className="rounded-lg border p-3"><p className="text-sm text-gray-600">{REPORT_CATEGORIES[key]}</p><p className="text-2xl font-bold">{money(report.summary.categories[key].amount)}</p><p className="text-xs text-gray-500">{report.summary.categories[key].adjustments} adjustments · {report.summary.categories[key].orders} receipts</p></div>)}
      <div className="rounded-lg border p-3"><p className="text-sm text-gray-600">All discounts, including meals</p><p className="text-2xl font-bold">{money(report.summary.discounts.amount)}</p><p className="text-xs text-gray-500">{report.summary.discounts.adjustments} adjustments</p></div>
      <div className="rounded-lg border p-3"><p className="text-sm text-gray-600">Voided item entries</p><p className="text-2xl font-bold">{report.summary.voided_entries}</p><p className="text-xs text-gray-500">{report.summary.deleted_entries} deleted · {report.summary.cleared_entries} cleared</p></div>
    </div>
    <p className="mt-2 text-xs text-gray-600">Dollar summaries include closed orders only. Meals are included in all discounts; don’t add those cards together. Counts are discount uses, not people fed. The POS account is not necessarily the meal recipient.</p>
    {Object.entries(coverage).some(([key,value])=>key !== "saved_orders" && value > 0) && <p role="status" className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
      Coverage: {coverage.unresolved_discounts} unclassified discounts; {coverage.missing_discounts} orders missing discount details; {coverage.missing_promotions} missing promotions; {coverage.legacy_void_details} older orders without version 3 void details; {coverage.missing_removal_flags} entries missing removal flags. Missing data is not zero.
    </p>}
    {report.summary.open_adjustments > 0 && <p className="mt-2 text-sm text-amber-800">{report.summary.open_adjustments} open-order adjustments appear in rows but are excluded from dollar summaries.</p>}
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Report type">
      {Object.entries(tabs).map(([key,label])=><button key={key} type="button" aria-pressed={tab === key} onClick={()=>setTab(key)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${tab === key ? "border-[#C8102E] bg-[#C8102E] text-white" : "border-gray-300 bg-white text-gray-700"}`}>{label}</button>)}
    </div>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">Search report<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Receipt, POS employee, item or offer" className="mt-1 block w-80 max-w-full rounded border px-3 py-2"/></label>
      {tab === "voids" && <label className="text-sm">Removal type<select value={removalType} onChange={e=>setRemovalType(e.target.value)} className="mt-1 block rounded border px-3 py-2"><option value="voided">Voided</option><option value="deleted">Deleted</option><option value="cleared">Cleared</option><option value="all">All removed entries</option></select></label>}
      <a href={`/api/integrations/brink?date=${status.business_date}&export=report-csv&type=${tab}`} className="rounded border px-3 py-2 text-sm font-semibold">Export {tab === "voids" ? "all removed entries" : "this report"} (CSV)</a>
    </div>
    <p className="mt-1 text-xs text-gray-500">Exports include the full selected report for this date, including open rows. Search filters only the screen.</p>
    {tab === "discounts" && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-semibold">Closed-order totals by offer</caption><thead><tr className="border-b"><th className="p-2">Offer / definition</th><th className="p-2">Category</th><th className="p-2">Uses / receipts</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>
      {report.by_definition.map(row=><tr key={`${row.kind}-${row.definition_id}-${row.name}`} className="border-b"><td className="p-2">{row.name}<span className="block text-xs text-gray-500">{row.kind} · ID {row.definition_id || "unavailable"}</span></td><td className="p-2">{REPORT_CATEGORIES[row.category]}</td><td className="p-2">{row.adjustments} / {row.orders}</td><td className="p-2 text-right">{money(row.amount)}</td></tr>)}
    </tbody></table></div>}
    <div className="mt-4 space-y-2">
      {tab === "voids" ? removals.map((r,i)=><details key={`${r.order_id}-${r.entry_id}-${i}`} className="rounded border p-3 text-sm">
        <summary className="cursor-pointer"><b>#{r.receipt}</b> · {r.item || `Menu ${r.item_id}`} · {[r.voided&&"Voided",r.deleted&&"Deleted",r.cleared&&"Cleared"].filter(Boolean).join(", ")} · {person(r.employee_name,r.employee_id)}</summary>
        <div className="mt-2 space-y-1 text-gray-600"><p>Order account: {person(r.employee_name,r.employee_id)} · {r.closed ? "Closed" : "Open"}{r.refund ? " · Refund" : ""}</p><p>Voided by: {person(r.voided_by,r.voided_by_id)} · Approved by: {person(r.approved_by,r.approved_by_id)}</p><p>Reason: {r.reason || (r.reason_id ? `Reason ${r.reason_id}` : "Not provided")} · Time: {time(r.voided_at)}</p><p>Entry {r.entry_id} · Menu {r.item_id}{r.composite_order_item_id ? ` · Part of entry ${r.composite_order_item_id}` : ""} · PAR price {money(r.price)}</p></div>
      </details>) : adjustments.map((a,i)=><details key={`${a.order_id}-${a.kind}-${a.adjustment_id}-${i}`} className="rounded border p-3 text-sm">
        <summary className="cursor-pointer"><b>#{a.receipt}</b> · {a.name} · <b>{money(a.amount)}</b> · {person(a.employee_name,a.employee_id)}{!a.closed ? " · OPEN — excluded from totals" : ""}{a.refund ? " · Refund" : ""}</summary>
        <div className="mt-2 space-y-1 text-gray-600"><p>Opened: {time(a.opened_at)} · {REPORT_CATEGORIES[a.category]} · Definition {a.definition_id || "unavailable"}</p><p>Applied by: {person(a.applied_by,a.applied_by_id)} · Approved by: {person(a.approved_by,a.approved_by_id)}</p><p>Affected entries: {a.items.length ? a.items.map(i=>`${i.name || i.entry_id}${i.removed ? " (removed)" : ""}`).join(", ") : "Item allocation not supplied"}</p><p>Receipt net sales {money(a.order_net_sales)} · Receipt total {money(a.order_total)}</p></div>
      </details>)}
      {(tab === "voids" ? !removals.length : !adjustments.length) && <p className="text-sm text-gray-500">No matching records in this saved snapshot.</p>}
    </div>
    <p className="mt-3 text-xs text-gray-600">{tab === "voids" ? "Void counts are item entries, including combo components. Deleted and cleared items are separate flags. Item prices are not a loss total. Empty orders do not prove cancellation." : "Categories use exact reviewed meal labels from this location’s current PAR catalog. Other employee discounts and manager comps stay under other discounts. Adjustments are already included in net sales."}</p>
  </section>;
}
