"use client";

import { CORRECTION_LABELS } from "@/lib/clock-corrections";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import { addDaysISO, getStoreToday, toStoreDateTimeLocal } from "@/lib/store-time";
import { weekStartSunday } from "@/lib/schedule";
import { payrollFilename } from "@/lib/timecards";
import { payPeriodFor, filterTimecardGroups } from "@/lib/timecard-review";

function PunchPhotoThumb({ url, label, noFace, onOpen }) {
  if (!url) {
    return <span className="text-[10px] text-zinc-400">{label}: none</span>;
  }
  return (
    <button type="button" onClick={onOpen} className="relative block" title={label}>
      <img src={url} alt={label} className="h-8 w-8 rounded-md object-cover" />
      <span className="mt-0.5 block text-[9px] font-semibold uppercase text-zinc-500">{label}</span>
      {noFace ? (
        <span className="absolute -right-1 -top-1 rounded bg-red-600 px-1 text-[9px] font-bold text-white">
          No face
        </span>
      ) : null}
    </button>
  );
}

function BreakSegments({ punch }) {
  const rows = punch.breaks || [];
  if (!rows.length && !punch.break_minutes) {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  return (
    <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
      {rows.map((row) => (
        <p key={row.id || `${row.start}-${row.end}`}>
          {row.start_label} – {row.end_label}
          {row.open ? " (open)" : row.minutes != null ? ` · ${row.minutes} min` : ""}
        </p>
      ))}
      {punch.break_minutes ? (
        <p className="font-medium text-zinc-800 dark:text-zinc-200">
          {punch.break_minutes} min unpaid
        </p>
      ) : null}
    </div>
  );
}

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TimecardsBoard() {
  const today = getStoreToday();
  const currentPeriod = payPeriodFor(today);
  const [from, setFrom] = useState(currentPeriod.from);
  const [to, setTo] = useState(currentPeriod.to);
  const [search, setSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [view, setView] = useState("punches");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(null);
  const [approving, setApproving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/timecards?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load timecards.");
      setPayload(data);
    } catch (err) {
      setError(err.message || "Could not load timecards.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const groups = payload?.groups || [];
    const grandMinutes = groups.reduce((sum, group) => sum + (Number(group.totalMinutes) || 0), 0);
    return {
      groups,
      grandMinutes,
      grandDisplay: payload?.grand_display || "0.00",
      grandExact: payload?.grand_exact,
      openCount: payload?.open_count || 0,
    };
  }, [payload]);
  const visibleGroups = useMemo(() => filterTimecardGroups(grouped.groups, search, reviewFilter), [grouped.groups, search, reviewFilter]);
  const periodOptions = Array.from({ length: 12 }, (_, index) => {
    const start = addDaysISO(currentPeriod.from, -index * 14);
    return { from: start, to: addDaysISO(start, 13) };
  });
  const selectedPeriod = periodOptions.find((period) => period.from === from && period.to === to);

  function setThisWeek() {
    const start = weekStartSunday(getStoreToday());
    setFrom(start);
    setTo(addDaysISO(start, 6));
  }

  function setLastWeek() {
    const start = addDaysISO(weekStartSunday(getStoreToday()), -7);
    setFrom(start);
    setTo(addDaysISO(start, 6));
  }

  function setLast14() {
    const end = getStoreToday();
    setFrom(addDaysISO(end, -13));
    setTo(end);
  }

  async function exportCsv() {
    setError("");
    try {
      const res = await fetch(`/api/timecards/export?from=${from}&to=${to}`);
      if (!res.ok) throw new Error((await res.json()).error || "Could not export payroll.");
      downloadCsv(payrollFilename(from, to), await res.text());
    } catch (err) { setError(err.message); }
  }
  async function approveTimecard(event) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const res = await fetch(`/api/timecards/${approving.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: approving.review_version, note: approving.note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not approve timecard.");
      setApproving(null); await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/timecards/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clock_in: editing.clock_in,
          clock_out: editing.clock_out || null,
          note: editing.note || "",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save punch.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message || "Could not save punch.");
    } finally {
      setSaving(false);
    }
  }

  const canEdit = Boolean(payload?.can_edit);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Timecards</h2>
          <p className="text-xs text-zinc-500">Review punches, approve flagged hours, and export payroll.</p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!payload || loading || payload.payroll_blocked}
          className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Export full period CSV
        </button>
      </div>

      {payload?.payroll_blocked && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
        <span><strong>Payroll on hold</strong> · {payload.pending_count} flagged · {payload.open_count || 0} open <span className="text-xs">— close and approve before exporting.</span></span>
        <button className="min-h-8 font-semibold underline" onClick={() => { setReviewFilter(payload.pending_count ? "pending" : "open"); setSearch(""); }}>Review punches</button>
      </div>}
      {!payload?.payroll_blocked && Boolean(payload?.open_count) && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{payload.open_count} open punches need closing before payroll.</p>}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <section aria-label="Timecard filters" className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1 text-xs font-semibold">Pay period
            <select aria-label="Pay period" value={selectedPeriod?.from || "custom"} onChange={event => {
              const period = periodOptions.find(item => item.from === event.target.value);
              if (period) { setFrom(period.from); setTo(period.to); }
            }} className="mt-1 block min-h-9 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:bg-zinc-900">
              {!selectedPeriod && <option value="custom">Custom date range</option>}
              {periodOptions.map(period => <option key={period.from} value={period.from}>{period.from} — {period.to}</option>)}
            </select>
          </label>
          <label className="min-w-40 flex-1 text-xs font-semibold">Employee
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search names" className="mt-1 block min-h-9 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm" />
          </label>
          <label className="text-xs font-semibold">Show
            <select value={reviewFilter} onChange={event => setReviewFilter(event.target.value)} className="mt-1 block min-h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:bg-zinc-900">
              <option value="all">All punches</option><option value="pending">Needs review</option><option value="open">Open punches</option><option value="unscheduled">Unscheduled</option><option value="edited">Edited punches</option><option value="long">Over 16 hours</option><option value="photo">Face not detected</option>
            </select>
          </label>
          <button type="button" disabled={loading} onClick={load} className="min-h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold disabled:opacity-50">Refresh</button>
          <div className="flex gap-1" aria-label="Timecard view">
            {[["punches","Punches"],["totals","Totals"]].map(([value,label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`min-h-9 rounded-md px-3 text-sm font-semibold ${view === value ? "bg-[#C8102E] text-white" : "border border-zinc-300"}`}>{label}</button>)}
          </div>
        </div>
        <details className="mt-2 text-xs">
          <summary className="w-fit cursor-pointer py-1 font-semibold text-zinc-600 dark:text-zinc-300">Change dates · {from} – {to}</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="ml-2 min-h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm" /></label>
            <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="ml-2 min-h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm" /></label>
            {[[setThisWeek,"This week"],[setLastWeek,"Last week"],[setLast14,"Last 14 days"]].map(([action,label]) => <button key={label} type="button" onClick={action} className="min-h-9 rounded-md border border-zinc-300 px-3 font-semibold">{label}</button>)}
          </div>
        </details>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
          <span>Recorded <strong className="text-sm tabular-nums">{payload?.grand_display || "0.00"} hrs</strong></span>
          <span>Cleared <strong className="text-sm tabular-nums text-green-700">{payload?.approved_display || "0.00"} hrs</strong></span>
          <span>Pending <strong className="text-sm tabular-nums text-red-700">{payload?.pending_display || "0.00"} hrs</strong></span>
          <span className="text-zinc-500">{visibleGroups.length} employees · {visibleGroups.reduce((sum,group) => sum + group.punches.length,0)} shown</span>
        </div>
      </section>

      {loading ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading timecards…</p>
      ) : !visibleGroups.length ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          No punches match this date range and these filters.
        </p>
      ) : (
        view === "totals" ? (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900">
            <table className="w-full text-left text-sm"><caption className="p-4 text-left font-semibold">Full-period employee totals · select a name to review punches</caption>
              <thead className="bg-red-50 text-zinc-700"><tr><th className="p-3">Employee</th><th className="p-3">Punches</th><th className="p-3">Open</th><th className="p-3">Recorded hours</th><th className="p-3">Cleared hours</th><th className="p-3">Pending hours</th></tr></thead>
              <tbody>{visibleGroups.map((group) => {
                const full = grouped.groups.find((item) => item.key === group.key);
                return <tr key={group.key} className="border-t border-zinc-100"><td className="p-3"><button className="font-semibold text-[#C8102E] underline" onClick={() => { setSearch(group.name); setReviewFilter('all'); setView('punches'); }}>{group.name}</button></td><td className="p-3">{full.punches.length}</td><td className="p-3">{full.openCount || 0}</td><td className="p-3 font-semibold">{full.totalDisplay}</td><td className="p-3">{full.approvedDisplay}</td><td className="p-3 text-red-800">{full.pendingDisplay}</td></tr>;
              })}</tbody>
            </table>
          </div>
        ) : visibleGroups.map((group) => (
          <section
            key={group.key}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="flex min-w-0 items-center gap-3">
                <EmployeeAvatar name={group.name} src={group.profile_photo_url} size="sm" />
                <div className="min-w-0">
                  <p className="font-semibold">{group.name}</p>
                  {group.openCount ? (
                    <p className="text-xs font-medium text-amber-800">{group.openCount} open</p>
                  ) : null}
                </div>
              </div>
              <p className="text-sm font-bold">{group.totalDisplay} hrs <span className="text-xs font-normal text-zinc-500">recorded / {group.approvedDisplay} cleared / {group.pendingDisplay} pending</span></p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-800">
                  <tr>
                    <th className="px-3 py-2">Photos</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">In</th>
                    <th className="px-3 py-2">Out</th>
                    <th className="px-3 py-2">Breaks</th>
                    <th className="px-3 py-2">Recorded</th>
                    <th className="px-3 py-2">Scheduled</th>
                    <th className="px-3 py-2">Status</th>
                    {canEdit ? <th className="px-3 py-2"> </th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.punches.map((punch) => (
                    <tr
                      key={punch.id}
                      className={`border-t border-zinc-100 dark:border-zinc-800 ${punch.pending_approval ? "bg-red-50/60" : punch.open ? "bg-amber-50/80" : ""}`}
                    >
                      <td className="px-3 py-2">
                        {punch.clock_in_photo_url || punch.clock_out_photo_url ? (
                          <div className="flex items-start gap-2">
                            <PunchPhotoThumb
                              url={punch.clock_in_photo_url}
                              label="In"
                              noFace={punch.clock_in_photo_url && !punch.face_detected_in}
                              onOpen={() => setLightbox(punch)}
                            />
                            <PunchPhotoThumb
                              url={punch.clock_out_photo_url}
                              label="Out"
                              noFace={punch.clock_out_photo_url && !punch.face_detected_out}
                              onOpen={() => setLightbox(punch)}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">No photo</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{punch.date_label}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{punch.clock_in_time}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {punch.open ? <span className="font-semibold text-amber-800">Open</span> : punch.clock_out_time}
                        {punch.clock_out && getStoreToday(new Date(punch.clock_out)) !== getStoreToday(new Date(punch.clock_in)) && <span className="block text-xs font-semibold text-amber-800">{getStoreToday(new Date(punch.clock_out))}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <BreakSegments punch={punch} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">
                        {punch.open ? (
                          "—"
                        ) : (
                          <span
                            title={
                              punch.worked_minutes == null
                                ? ""
                                : `${punch.worked_minutes} min ÷ 60${
                                    punch.break_minutes
                                      ? ` (minus ${punch.break_minutes} min unpaid break)`
                                      : ""
                                  }`
                            }
                          >
                            {punch.worked_hours_display} hrs
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{punch.scheduled_label}</td>
                      <td className="px-3 py-2">
                        <details className="min-w-32 max-w-64 text-xs">
                          <summary className={`cursor-pointer py-1 font-semibold ${punch.pending_approval ? "text-red-800" : punch.open ? "text-amber-800" : "text-green-800"}`}>
                            {punch.pending_approval ? `Needs review (${punch.review_flags.length})` : punch.open ? "Open shift" : punch.approval ? "Approved" : punch.payroll_ready ? "Cleared" : "Details"}
                          </summary>
                          <div className="mt-2 border-t border-zinc-200 pt-2">
                        <div className="mb-2 text-xs">
                          {punch.corrections?.map(c => <p key={c.id} className="mb-2 text-zinc-700 dark:text-zinc-300">{CORRECTION_LABELS[c.correction_type] || c.correction_type}: {toStoreDateTimeLocal(c.claimed_time).replace("T", " ")} — {c.reason}{c.photo_url && <a href={c.photo_url} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-[#C8102E] underline">View correction photo</a>}</p>)}
                          {punch.pending_approval ? <div className="font-semibold text-red-800"><p>⚑ Manager approval required</p>{punch.review_flags.map((flag) => <p key={flag}>{flag}</p>)}</div> : punch.approval ? <div className="text-green-800"><p>Approved by {punch.approval.approved_by_name}</p><p>{toStoreDateTimeLocal(punch.approval.approved_at).replace("T", " ")}</p><p>{punch.approval.note}</p></div> : punch.payroll_ready ? <p className="text-green-800">Cleared for payroll</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {punch.clock_out && Date.parse(punch.clock_out) - Date.parse(punch.clock_in) > 16 * 3600000 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">Over 16 hours · review</span>}
                          {punch.on_break ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                              On break
                            </span>
                          ) : null}
                          {punch.open ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                              Open
                            </span>
                          ) : null}
                          {punch.edited ? (
                            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                              Edited
                            </span>
                          ) : null}
                          {punch.unscheduled ? (
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                              Unscheduled
                            </span>
                          ) : null}
                          {punch.authorized_by ? (
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                              Auth: {punch.authorized_by}
                            </span>
                          ) : null}
                        </div>
                          </div>
                        </details>
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2">
                          {punch.pending_approval && <button type="button" disabled={punch.open || punch.on_break || punch.breaks.some((row) => row.open)} onClick={() => { setError(""); setApproving({ ...punch, note: "" }); }} className="mb-1 block min-h-8 rounded bg-[#C8102E] px-2 py-1 text-xs font-semibold text-white disabled:opacity-40">Review &amp; approve</button>}
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                id: punch.id,
                                name: punch.employee_name,
                                clock_in: toStoreDateTimeLocal(punch.clock_in),
                                clock_out: punch.clock_out ? toStoreDateTimeLocal(punch.clock_out) : "",
                                note: "",
                              })
                            }
                            className="text-xs font-semibold text-[#C8102E]"
                          >
                            Edit
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <p className="text-sm font-semibold text-zinc-700">
        Recorded period total: {payload?.grand_display || "0.00"} hrs
      </p>
      {!canEdit && payload ? (
        <p className="text-xs text-zinc-500">Shift leads can review timecards. GM or assistant manager can correct punches and approve red flags.</p>
      ) : null}

      {lightbox ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setLightbox(null)}>
          <div className="max-h-[90vh] max-w-2xl overflow-auto rounded-xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold">
              {lightbox.employee_name} · {lightbox.clock_in_label}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">Clock in</p>
                {lightbox.clock_in_photo_url ? (
                  <img src={lightbox.clock_in_photo_url} alt="Clock-in photo" className="max-h-[60vh] w-full rounded-lg object-contain" />
                ) : (
                  <p className="text-sm text-zinc-500">No clock-in photo</p>
                )}
                {lightbox.clock_in_photo_url && !lightbox.face_detected_in ? (
                  <p className="mt-2 text-sm font-medium text-red-700">Face was not detected at clock-in.</p>
                ) : null}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">Clock out</p>
                {lightbox.clock_out_photo_url ? (
                  <img src={lightbox.clock_out_photo_url} alt="Clock-out photo" className="max-h-[60vh] w-full rounded-lg object-contain" />
                ) : (
                  <p className="text-sm text-zinc-500">No clock-out photo</p>
                )}
                {lightbox.clock_out_photo_url && !lightbox.face_detected_out ? (
                  <p className="mt-2 text-sm font-medium text-red-700">Face was not detected at clock-out.</p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="mt-3 w-full rounded-lg border border-zinc-300 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {approving && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <form role="dialog" aria-modal="true" aria-labelledby="approval-title" onSubmit={approveTimecard} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
          <h3 id="approval-title" className="text-lg font-bold text-[#C8102E]">Review flagged timecard</h3>
          <p className="mt-2 font-semibold">{approving.employee_name}</p>
          <p className="mt-2 text-sm">{approving.clock_in_label} to {approving.clock_out_label}</p>
          <p className="text-sm">Scheduled: {approving.scheduled_label}</p>
          <p className="mt-2 font-semibold">{approving.worked_hours_display} recorded hours / {approving.break_minutes} unpaid break minutes</p>
          <ul className="my-3 list-inside list-disc text-sm text-red-800">{approving.review_flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
          {approving.corrections?.map(c => <p key={c.id} className="my-2 text-sm">{CORRECTION_LABELS[c.correction_type] || c.correction_type}: {toStoreDateTimeLocal(c.claimed_time).replace("T", " ")} — {c.reason}{c.photo_url && <a href={c.photo_url} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-[#C8102E] underline">View correction photo</a>}</p>)}
          <p className="text-sm text-zinc-600">Confirm these hours were worked. Approval clears this timecard for payroll and records your name, time, and note. Later changes require a new review.</p>
          <label className="mt-4 block text-sm font-semibold">Review note<textarea required maxLength={1000} value={approving.note} onChange={(event) => setApproving({ ...approving, note: event.target.value })} className="mt-1 block w-full rounded border border-zinc-300 p-2" /></label>
          {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
          <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setApproving(null)} className="rounded border px-3 py-2">Cancel</button><button type="submit" disabled={saving || !approving.note.trim()} className="rounded bg-[#C8102E] px-3 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Approve recorded hours"}</button></div>
        </form>
      </div>}
      {editing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <h3 className="text-lg font-semibold text-[#C8102E]">Edit punch</h3>
            <p className="mt-1 text-sm text-zinc-500">{editing.name}</p>
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <label className="mt-4 block text-xs font-medium text-zinc-600">
              Clock in
              <input
                type="datetime-local"
                step="1"
                required
                value={editing.clock_in}
                onChange={(e) => setEditing((s) => ({ ...s, clock_in: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-zinc-600">
              Clock out
              <input
                type="datetime-local"
                step="1"
                value={editing.clock_out}
                onChange={(e) => setEditing((s) => ({ ...s, clock_out: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-zinc-600">
              Note (optional)
              <input
                value={editing.note}
                onChange={(e) => setEditing((s) => ({ ...s, note: e.target.value }))}
                placeholder="Why this was corrected"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
