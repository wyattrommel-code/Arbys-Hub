"use client";
import { useState } from "react";
import { formatStoreDateTime } from "@/lib/store-time";
import { orderMatches } from "@/lib/brink-order-data";

const dollars = v => v == null ? "Not captured" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const employee = (id, name) => name ? `${name} · POS ${id}` : id ? `POS employee ${id}` : "Not provided";
function Adjustments({ title, values }) {
  return <div><h5 className="font-semibold">{title}</h5>{values == null ? <p className="text-gray-500">Not captured in this snapshot.</p> : !values.length ? <p className="text-gray-500">None reported.</p> : <ul className="space-y-1">{values.map((a, i) => <li key={`${a.id}-${i}`}>
    <span className="font-medium">{a.name || `Definition ${a.definition_id || "unavailable"}`}</span> · {dollars(a.amount)}
    <span className="block text-xs text-gray-600">Applied by {employee(a.employee_id, a.employee_name)}{a.approver_employee_id ? ` · Approved by ${employee(a.approver_employee_id, a.approver_employee_name)}` : ""}</span>
  </li>)}</ul>}</div>;
}
function Modifiers({ modifiers }) {
  if (!modifiers?.length) return null;
  return <ul className="ml-3 mt-1 border-l pl-2 text-xs text-gray-600">{modifiers.map((m, i) => <li key={`${m.id}-${i}`}>
    Modifier item {m.item_id || "unknown"} · code {m.modifier_code_id || "—"} · {dollars(m.price)}
    <Modifiers modifiers={m.modifiers} />
  </li>)}</ul>;
}
function Allocations({ values, offers, label }) {
  if (!values?.length) return null;
  return <ul className="text-xs text-gray-600">{values.map((a, i) => <li key={`${a.id}-${i}`}>
    {label}: {offers?.find(o => o.id === a.order_adjustment_id)?.name || `Adjustment ${a.order_adjustment_id || "unknown"}`} {dollars(a.amount)}
  </li>)}</ul>;
}
export default function BrinkOrderDetails({ orders, date }) {
  const [query, setQuery] = useState("");
  const visible = orders.filter(o => o.items.length || o.total !== 0).filter(o => orderMatches(o, query));
  return <div className="mt-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="text-sm font-medium">Find an order<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Order, employee, item or offer" className="mt-1 block w-72 max-w-full rounded border border-gray-300 px-3 py-2" /></label>
      <a href={`/api/integrations/brink?date=${date}&export=orders`} className="rounded border border-[#C8102E] px-3 py-2 text-sm font-semibold text-[#C8102E]">Download order details (JSON)</a>
    </div>
    <p className="mt-2 text-xs text-gray-500">Employee = the POS account that processed the order. Names use a cached PAR directory; they do not identify the person speaking. Coupon menu items appear with the other items.</p>
    <div className="mt-3 space-y-2">{visible.map(order => {
      const parents = new Set(order.items.map(i => i.composite_order_item_id).filter(Boolean));
      const offerNames = [...(order.discounts || []), ...(order.promotions || [])].map(a => a.name || "Unnamed adjustment");
      return <details key={order.id} className="rounded-lg border border-gray-200">
        <summary className="cursor-pointer p-3 text-sm">
          <span className="font-bold text-[#C8102E]">#{order.number}</span> · {employee(order.employee_id, order.employee_name)} · {order.refund ? "Refund" : order.closed ? "Closed" : "Open"} · <strong>{dollars(order.total)}</strong>
          <span className="mt-1 block text-gray-600">{order.items.map(i => `${i.description || `Item ${i.item_id}`}${i.voided || i.deleted || i.cleared ? " (removed)" : ""}`).join(", ")}</span>
          {offerNames.length > 0 && <span className="mt-1 block font-medium">Offers: {offerNames.join(", ")}</span>}
        </summary>
        <div className="border-t bg-gray-50 p-3 text-sm">
          {!order.details_version && <p className="mb-2 text-amber-800">Older snapshot: import this date again to capture discounts, promotions and modifiers.</p>}
          <p>Opened: {order.opened_at ? formatStoreDateTime(order.opened_at) : "Not provided"} · Closed: {order.closed_at ? formatStoreDateTime(order.closed_at) : "Not closed"} · Terminal {order.terminal_id || "—"}</p>
          <p className="mt-1 text-xs text-gray-500">PAR order ID {order.id} · Net sales {dollars(order.net_sales)} · Tax {dollars(order.tax)} · Total {dollars(order.total)}</p>
          <div className="my-3 grid gap-3 sm:grid-cols-2"><Adjustments title="Discounts" values={order.discounts} /><Adjustments title="Promotions" values={order.promotions} /></div>
          <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b text-xs text-gray-600"><th className="p-2">Item / modifiers</th><th className="p-2">Entry / combo</th><th className="p-2 text-right">PAR price</th><th className="p-2 text-right">Item-only net</th></tr></thead>
            <tbody>{order.items.map((item, i) => <tr key={`${item.id}-${i}`} className={`border-b align-top ${item.voided || item.deleted || item.cleared ? "text-gray-500" : ""}`}>
              <td className="p-2"><span className="font-medium">{item.description || `Item ${item.item_id || "unknown"}`}</span>{(item.voided || item.deleted || item.cleared) && <strong className="ml-1 text-red-700">Removed</strong>}
                <span className="block text-xs text-gray-500">Menu ID {item.item_id || "not provided"}</span>
                <Modifiers modifiers={item.modifiers} />
                <Allocations values={item.discounts} offers={order.discounts} label="Discount share" /><Allocations values={item.promotions} offers={order.promotions} label="Promotion share" />
              </td>
              <td className="p-2 text-xs">Entry {item.id}{parents.has(item.id) && <span className="block font-semibold">Combo / offer parent</span>}{item.composite_order_item_id && <span className="block">Part of entry {item.composite_order_item_id}</span>}{item.split_denominator > 1 && <span className="block">Split denominator {item.split_denominator}</span>}</td>
              <td className="p-2 text-right">{dollars(item.price)}</td><td className="p-2 text-right">{dollars(item.item_net_sales)}</td>
            </tr>)}</tbody></table></div>
          <p className="mt-2 text-xs text-gray-500">Combo prices can sit on the parent while sales are allocated to components. Adjustments are already reflected in net sales. Modifier names and ingredient usage still need a menu/recipe mapping.</p>
        </div>
      </details>;
    })}</div>
    {!visible.length && <p className="mt-3 text-sm text-gray-500">No matching orders.</p>}
  </div>;
}
