"use client";
import { useEffect, useState } from "react";
import { formatStoreDateTime } from "@/lib/store-time";
export default function BrinkCallLog({ date }) {
  const [rows, setRows] = useState([]);
  const [before, setBefore] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/integrations/brink/logs?date=${date}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setRows(result.calls); setNext(result.next_before); setError("");
      } catch (err) { if (err.name !== "AbortError") setError(err.message || "Could not load API log."); }
    };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [date, before]);
  async function open(id) {
    try {
      const response = await fetch(`/api/integrations/brink/logs?date=${date}&id=${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDetail(result.calls[0] || null);
    } catch (err) { setError(err.message); }
  }
  return <div className="mt-6 border-t border-gray-200 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-[#C8102E]">API call log</h4><a className="text-sm text-[#C8102E] underline" href={`/api/integrations/brink/logs?date=${date}&export=1`}>Download day’s call log</a></div>
    <p className="mt-1 text-xs text-gray-500">All Hub-to-PAR calls from logging activation onward. Request history: 30 days. Sanitized response XML: 24 hours, up to 64 KiB per call. Credentials and customer/payment details are excluded.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">Started</th><th>Call / source</th><th>Result</th><th>Duration</th><th>Orders</th><th>Evidence</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b"><td className="p-2">{formatStoreDateTime(row.started_at)}</td><td>{row.operation}<br/>{row.source}</td><td className={row.status === "error" ? "text-red-700" : "text-gray-700"}>{row.status === "started" && Date.now() - Date.parse(row.started_at) > 5 * 60000 ? "Incomplete" : row.status}<br/>{row.http_status ? `HTTP ${row.http_status}` : ""}{row.result_code != null ? ` · PAR ${row.result_code}` : ""}</td><td>{row.duration_ms == null ? "—" : `${(row.duration_ms / 1000).toFixed(2)}s`}</td><td>{row.order_count ?? "—"}</td><td><button type="button" className="p-2 text-[#C8102E] underline" onClick={() => open(row.id)}>View</button></td></tr>)}</tbody></table></div>
    {!rows.length && <p className="mt-2 text-sm text-gray-500">No recorded calls for this date yet.</p>}
    <div className="mt-2 flex gap-4 text-sm">{before && <button className="underline" onClick={() => setBefore(null)}>Latest calls</button>}{next && <button className="underline" onClick={() => setBefore(next)}>Older calls</button>}</div>
    {detail && <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs"><div className="flex justify-between"><strong>Call {detail.id}</strong><button onClick={() => setDetail(null)}>Close details</button></div><p className="mt-2">{detail.endpoint} · {detail.business_date}</p>{detail.error && <p className="mt-2 text-red-700">{detail.error}</p>}<p className="mt-2 break-all">Response SHA-256: {detail.response_sha256 || "No response captured"}</p><p className="mt-2 font-bold">Request XML (authentication headers omitted)</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{detail.request_xml}</pre><p className="mt-3 font-bold">Sanitized response XML · not an unmodified raw response</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all">{detail.response_xml || "Response XML unavailable, expired, or not valid XML. See status and hash."}</pre><a className="mt-3 inline-block text-[#C8102E] underline" href={`/api/integrations/brink/logs?date=${date}&id=${detail.id}&export=1`}>Download this call’s evidence</a></div>}
  </div>;
}
