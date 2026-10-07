"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, X } from "lucide-react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import PunchEditor from "@/components/timecards/PunchEditor";
import { CORRECTION_LABELS } from "@/lib/clock-corrections";
import { addDaysISO, formatStoreDateTime, getStoreToday, toStoreDateTimeLocal } from "@/lib/store-time";
import { weekStartSunday } from "@/lib/schedule";
import { payrollFilename } from "@/lib/timecards";
import { timecardReportFilename } from "@/lib/timecard-reports";
import { matchesPunchReview, payPeriodFor } from "@/lib/timecard-review";
import styles from "./TimecardsBoard.module.css";

const fieldClass = "h-9 min-w-0 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const buttonClass = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

function dateLabel(date) {
  if (!date) return "—";
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  });
}

function Flags({ punch }) {
  const flags = [];
  if (punch.pending_approval) flags.push(["Needs review", "red"]);
  else if (punch.approval) flags.push(["Approved", "green"]);
  if (punch.on_break) flags.push(["On break", "amber"]);
  else if (punch.open) flags.push(["Open", "amber"]);
  if (punch.unscheduled) flags.push(["Unscheduled", "purple"]);
  if ((punch.clock_in_photo_url && !punch.face_detected_in) || (punch.clock_out_photo_url && !punch.face_detected_out)) flags.push(["No face detected", "red"]);
  if (punch.edited) flags.push(["Edited", "gray"]);
  const colors = {
    green: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
    red: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
    amber: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    purple: "bg-purple-50 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
    gray: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return flags.length ? <div className="flex flex-wrap gap-1">{flags.map(([label, color]) => (
    <span key={label} className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + colors[color]}>{label}</span>
  ))}</div> : <span className="text-xs text-zinc-500">{punch.payroll_ready ? "Cleared" : "—"}</span>;
}

function Corrections({ punch }) {
  return punch.corrections?.map((correction) => <p key={correction.id} className="mt-2 text-xs leading-relaxed">
    <span className="font-medium">{correction.source === "offline" ? "Offline " + correction.correction_type.replace("forgot_", "").replaceAll("_", " ") : CORRECTION_LABELS[correction.correction_type] || "Punch correction"}</span>
    {": "}{formatStoreDateTime(correction.claimed_time)} · {correction.reason}
    {correction.photo_url ? <a href={correction.photo_url} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-[#C8102E] underline dark:text-red-300">View correction photo</a> : null}
  </p>);
}

function PunchTime({ punch, direction, onOpen }) {
  const isIn = direction === "in";
  const timestamp = isIn ? punch.clock_in : punch.clock_out;
  const photo = isIn ? punch.clock_in_photo_url : punch.clock_out_photo_url;
  const time = isIn ? punch.clock_in_time : punch.clock_out_time;
  return <div className="flex items-center gap-2">
    {photo ? <button type="button" onClick={onOpen} className="shrink-0 rounded-md" aria-label={"View clock-" + direction + " photo for " + punch.employee_name}>
      <img src={photo} alt="" loading="lazy" className="h-9 w-9 rounded-md object-cover" />
    </button> : null}
    {timestamp ? <time dateTime={timestamp} className="block whitespace-nowrap leading-snug">
      <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{dateLabel(getStoreToday(new Date(timestamp)))}</span>
      <span className="tabular-nums">{time}</span>
    </time> : <span className="text-zinc-400">—</span>}
  </div>;
}

function PunchDetails({ punch }) {
  return <div className="grid gap-4 text-xs sm:grid-cols-3">
    <div><p className="mb-1 font-semibold">Scheduled shift</p><p className="text-zinc-600 dark:text-zinc-400">{punch.scheduled_label}</p>
      {punch.authorized_by ? <p className="mt-1">Authorized by {punch.authorized_by}</p> : null}</div>
    <div><p className="mb-1 font-semibold">Breaks</p>
      {(punch.breaks || []).map((row, index) => <p key={row.id || index} className="text-zinc-600 dark:text-zinc-400">
        {row.start_label} – {row.end_label} · {row.open ? "On break" : row.minutes + " min"}
      </p>)}
      <p className="mt-1">{punch.break_minutes || 0} min unpaid total</p>
    </div>
    <div><p className="mb-1 font-semibold">Paid time</p>
      <p>{punch.open ? "Clock out to calculate paid time." : (punch.worked_minutes ?? 0) + " paid minutes ÷ 60 = " + punch.worked_hours_display + " hours"}</p>
      {!punch.payroll_ready ? <p className="mt-1 font-medium text-red-700 dark:text-red-300">Not yet cleared for payroll.</p> : null}
      {punch.review_flags?.length ? <ul className="mt-2 list-inside list-disc">{punch.review_flags.map((flag) => <li key={flag}>{flag}</li>)}</ul> : null}
      {punch.approval ? <div className="mt-2 text-green-800 dark:text-green-300"><p>Approved by {punch.approval.approved_by_name} · {formatStoreDateTime(punch.approval.approved_at)}</p><p>{punch.approval.note}</p></div> : null}
      <Corrections punch={punch} />
    </div>
  </div>;
}

function Modal({ title, onClose, busy = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} aria-labelledby="timecard-dialog-title" className={styles.dialog}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
      <h3 id="timecard-dialog-title" className="font-semibold">{title}</h3>
      <button type="button" onClick={onClose} disabled={busy} className={buttonClass} aria-label="Close dialog"><X size={16} /></button>
    </div>
    <div className="p-5">{children}</div>
  </dialog>;
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
  const currentPeriod = payPeriodFor(getStoreToday());
  const [from, setFrom] = useState(currentPeriod.from);
  const [to, setTo] = useState(currentPeriod.to);
  const [preset, setPreset] = useState(currentPeriod.from);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(null);
  const [approving, setApproving] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState("punches");
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [view, setView] = useState("punches");
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState({ key: "clock_in", direction: "desc" });
  const activeRequest = useRef(null);
  const validRange = Boolean(from && to && from <= to);
  const periodOptions = Array.from({ length: 12 }, (_, index) => {
    const start = addDaysISO(currentPeriod.from, -index * 14);
    return { from: start, to: addDaysISO(start, 13) };
  });

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    if (!from || !to || from > to) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/timecards?from=" + from + "&to=" + to, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load timecards.");
      if (!controller.signal.aborted) setPayload(data);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err.message || "Could not load timecards.");
      setPayload(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    // Defer to keep rapid date edits from starting redundant requests.
    const timer = setTimeout(load, 150);
    return () => { clearTimeout(timer); activeRequest.current?.abort(); };
  }, [load]);

  const grouped = useMemo(() => {
    const groups = payload?.groups || [];
    return { groups, grandMinutes: groups.reduce((sum, group) => sum + (Number(group.totalMinutes) || 0), 0) };
  }, [payload]);
  const allPunches = useMemo(() => grouped.groups.flatMap((group) => group.punches.map((punch) => ({
    ...punch, groupKey: String(group.key), profile_photo_url: group.profile_photo_url,
  }))), [grouped]);
  const selectedPerson = grouped.groups.some((group) => String(group.key) === person) ? person : "";
  const visiblePunches = useMemo(() => allPunches.filter((punch) =>
    (!selectedPerson || punch.groupKey === selectedPerson) && punch.employee_name.toLowerCase().includes(search.trim().toLowerCase()) && matchesPunchReview(punch, reviewFilter)
  ).sort((a, b) => {
    const first = a[sort.key];
    const second = b[sort.key];
    // Keep incomplete hours/timestamps at the end in either sort direction.
    if (first == null && second == null) return 0;
    if (first == null) return 1;
    if (second == null) return -1;
    const result = sort.key === "worked_minutes" ? first - second : String(first).localeCompare(String(second));
    return sort.direction === "asc" ? result : -result;
  }), [allPunches, selectedPerson, search, reviewFilter, sort]);
  const visibleGroups = grouped.groups.filter((group) => (!selectedPerson || String(group.key) === selectedPerson) && group.name.toLowerCase().includes(search.trim().toLowerCase()));
  const ready = validRange && !loading && payload?.from === from && payload?.to === to;
  const exportBlocked = payload?.payroll_blocked || (exportType !== "payroll" && payload?.labor_report?.blocked);
  const canEdit = Boolean(payload?.can_edit);
  const personIndex = grouped.groups.findIndex((group) => String(group.key) === selectedPerson);

  function changePreset(value) {
    setPreset(value);
    if (value === "custom") return;
    const period = periodOptions.find((option) => option.from === value);
    if (period) { setFrom(period.from); setTo(period.to); return; }
    const today = getStoreToday();
    const start = weekStartSunday(today);
    setFrom(value === "last" ? addDaysISO(start, -7) : value === "14" ? addDaysISO(today, -13) : start);
    setTo(value === "last" ? addDaysISO(start, -1) : value === "14" ? today : addDaysISO(start, 6));
  }

  function shiftPeriod(direction) {
    if (!validRange) return;
    const days = Math.round((new Date(to + "T12:00:00Z") - new Date(from + "T12:00:00Z")) / 86400000) + 1;
    setFrom(addDaysISO(from, days * direction));
    setTo(addDaysISO(to, days * direction));
    const nextFrom = addDaysISO(from, days * direction);
    const nextTo = addDaysISO(to, days * direction);
    setPreset(periodOptions.some((period) => period.from === nextFrom && period.to === nextTo) ? nextFrom : "custom");
  }

  function sortBy(key) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function openEdit(punch) {
    setEditError("");
    setEditing({ id: punch.id, name: punch.employee_name, version: punch.edit_version,
      breaks: (punch.breaks || []).map((row) => ({ id: row.id, key: row.id, start: toStoreDateTimeLocal(row.start), end: row.end ? toStoreDateTimeLocal(row.end) : "" })),
      edits: punch.edits || [], scheduled_unpaid: payload.use_break_punches ? null : punch.break_minutes,
      clock_in: toStoreDateTimeLocal(punch.clock_in),
      clock_out: punch.clock_out ? toStoreDateTimeLocal(punch.clock_out) : "", note: "" });
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setEditError("");
    try {
      const res = await fetch("/api/timecards/" + editing.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: editing.version,
          breaks: editing.breaks.filter((row) => !row.removed).map(({ id, start, end }) => ({ id, start, end: end || null })),
          clock_in: editing.clock_in, clock_out: editing.clock_out || null, note: editing.note || "" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save punch.");
      setEditing(null);
      await load();
    } catch (err) { setEditError(err.message || "Could not save punch."); }
    finally { setSaving(false); }
  }

  async function approveTimecard(event) {
    event.preventDefault();
    if (!approving || saving) return;
    setSaving(true); setEditError("");
    try {
      const res = await fetch(`/api/timecards/${approving.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: approving.review_version, note: approving.note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not approve timecard.");
      setApproving(null); await load();
    } catch (err) { setEditError(err.message); }
    finally { setSaving(false); }
  }

  async function exportCsv() {
    if (!ready || exportBlocked || exporting) return;
    setExporting(true); setError("");
    try {
      const res = await fetch(`/api/timecards/export?from=${from}&to=${to}&type=${exportType}`);
      if (!res.ok) throw new Error((await res.json()).error || "Could not export payroll.");
      downloadCsv(exportType === "payroll" ? payrollFilename(from, to) : timecardReportFilename(exportType, from, to), await res.text());
    } catch (err) { setError(err.message); }
    finally { setExporting(false); }
  }

  function sortHeading(key, label, className = "") {
    return <th scope="col" className={className} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(key)} className="inline-flex items-center gap-1 font-semibold">
        {label}<span aria-hidden="true" className="text-zinc-400">{sort.key === key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
      </button>
    </th>;
  }

  return <div className={styles.board + " w-full min-w-0 flex-1 px-4 py-4 sm:px-6"}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Timecards</h2><p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Review punches and hours for payroll.</p></div>
      <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="timecard-export-type">Export report</label>
      <select id="timecard-export-type" value={exportType} onChange={(event) => setExportType(event.target.value)} className={fieldClass} disabled={exporting}>
        <option value="punches">Total punches</option><option value="summary">Employee totals</option><option value="payroll">Original payroll format</option>
      </select>
      <button type="button" disabled={!ready || exportBlocked || exporting} onClick={exportCsv}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-[#C8102E] px-3 text-xs font-semibold text-white hover:bg-[#a90e27] disabled:opacity-40">
        <Download size={15} />{exporting ? "Exporting…" : "Export CSV"}
      </button>
      </div>
    </div>

    {exportType === "summary" && payload?.can_export_pay ? <p className="mb-3 text-xs text-zinc-500">Employee totals CSV includes estimated regular, overtime, and total pay using wage history effective on each shift date.</p> : null}

    <div className="mb-4 flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-[11px] font-medium text-zinc-500">Pay period
        <select value={preset} onChange={(event) => changePreset(event.target.value)} className={fieldClass}>
          {periodOptions.map((period) => <option key={period.from} value={period.from}>{dateLabel(period.from)} – {dateLabel(period.to)}</option>)}
          <option value="week">This week</option><option value="last">Last week</option><option value="14">Last 14 days</option><option value="custom">Custom range</option>
        </select>
      </label>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => shiftPeriod(-1)} disabled={!validRange} className={buttonClass} aria-label="Previous date range"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => shiftPeriod(1)} disabled={!validRange} className={buttonClass} aria-label="Next date range"><ChevronRight size={16} /></button>
      </div>
      <label className="grid gap-1 text-[11px] font-medium text-zinc-500">Start date
        <input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPreset("custom"); }} className={fieldClass} />
      </label>
      <label className="grid gap-1 text-[11px] font-medium text-zinc-500">End date
        <input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPreset("custom"); }} className={fieldClass} />
      </label>
      <button type="button" onClick={load} disabled={!validRange || loading} className={buttonClass} aria-label="Refresh timecards"><RefreshCw size={15} /></button>
    </div>

    {!validRange ? <p role="alert" className="mb-3 text-sm text-red-700">Choose a start date on or before the end date.</p> : null}
    {error ? <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" onClick={load} className="font-semibold underline">Try again</button></div> : null}

    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" aria-label="Timecard records">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex gap-1" aria-label="Timecard view">
          {[["punches", "Punches"], ["totals", "Employee totals"]].map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
            className={"rounded-md px-3 py-2 text-xs font-semibold " + (view === value ? "bg-[#C8102E]/10 text-[#C8102E] dark:text-red-300" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800")}>{label}</button>)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500" aria-live="polite">
          <span>Recorded <strong className="ml-1 tabular-nums text-zinc-900 dark:text-zinc-100">{ready ? payload.grand_display : "—"} hrs</strong></span>
          <span>Cleared <strong className="ml-1 tabular-nums text-green-800 dark:text-green-300">{ready ? payload.approved_display : "—"} hrs</strong></span>
          <span>Pending <strong className="ml-1 tabular-nums text-red-800 dark:text-red-300">{ready ? payload.pending_display : "—"} hrs</strong></span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" className={buttonClass + " !px-1.5"} disabled={personIndex < 0} aria-label="Previous employee" onClick={() => setPerson(personIndex === 0 ? "" : String(grouped.groups[personIndex - 1].key))}><ChevronLeft size={16} /></button>
          <label className="sr-only" htmlFor="timecard-employee">Employee</label>
          <select id="timecard-employee" value={selectedPerson} onChange={(event) => setPerson(event.target.value)} className={fieldClass + " w-48 sm:w-56"}>
            <option value="">All employees</option>{grouped.groups.map((group) => <option key={group.key} value={String(group.key)}>{group.name}</option>)}
          </select>
          <button type="button" className={buttonClass + " !px-1.5"} disabled={personIndex >= grouped.groups.length - 1} aria-label="Next employee" onClick={() => setPerson(String(grouped.groups[personIndex + 1].key))}><ChevronRight size={16} /></button>
        </div>
        <input type="search" aria-label="Search employees" placeholder="Search employees" value={search} onChange={(event) => setSearch(event.target.value)} className={fieldClass + " w-40"} />
        {view === "punches" ? <select aria-label="Review filter" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)} className={fieldClass}>
          <option value="all">All punches</option><option value="pending">Needs approval</option><option value="open">Open punches</option>
          <option value="unscheduled">Unscheduled</option><option value="edited">Edited punches</option><option value="long">Over 16 hours</option><option value="photo">No face detected</option>
        </select> : null}
        <p className="ml-auto text-xs tabular-nums text-zinc-500" role="status">{ready ? view === "punches" ? visiblePunches.length + " of " + allPunches.length + " punches" : visibleGroups.length + " employees" : ""}</p>
      </div>

      {ready && payload.labor_report?.context_pending_count > 0 ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Overtime export on hold: {payload.labor_report.context_pending_count} earlier punches in these workweeks need review. Select the full workweek to resolve them.</p> : null}
      {ready && payload.payroll_blocked ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50/70 px-4 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
        <span><strong>Payroll on hold</strong> · {payload.pending_count} flagged · {payload.open_count || 0} open. Close and approve before exporting.</span>
        <button type="button" onClick={() => { setView("punches"); setReviewFilter(payload.pending_count ? "pending" : "open"); setPerson(""); setSearch(""); }} className="font-semibold underline underline-offset-2">Review punches</button>
      </div> : null}

      {!ready ? <p className="px-4 py-12 text-center text-sm text-zinc-500" role="status">{error ? "Timecards could not be loaded." : !validRange ? "Select a valid date range." : "Loading timecards…"}</p> : view === "punches" ? <>
        <table className={styles.punchTable}>
          <caption className="sr-only">Punches from {dateLabel(from)} to {dateLabel(to)}</caption>
          <thead><tr>{sortHeading("employee_name", "Person")}{sortHeading("clock_in", "Clock in")}{sortHeading("clock_out", "Clock out")}
            <th scope="col">Breaks</th>{sortHeading("worked_minutes", "Hours", styles.numeric)}<th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>{visiblePunches.map((punch) => <Fragment key={punch.id}>
            <tr className={styles.punchRow}>
              <td className={styles.personCell}><div className="flex items-center gap-2"><EmployeeAvatar name={punch.employee_name} src={punch.profile_photo_url} size="sm" /><span className="font-medium">{punch.employee_name}</span></div></td>
              <td><span className={styles.mobileLabel}>Clock in</span><PunchTime punch={punch} direction="in" onOpen={() => setLightbox(punch)} /></td>
              <td><span className={styles.mobileLabel}>Clock out</span><PunchTime punch={punch} direction="out" onOpen={() => setLightbox(punch)} /></td>
              <td><span className={styles.mobileLabel}>Unpaid breaks</span><span className="whitespace-nowrap tabular-nums text-zinc-500">{punch.break_minutes ? punch.break_minutes + " min" : "—"}</span></td>
              <td className={styles.numeric}><span className={styles.mobileLabel}>Recorded hours</span><span className="font-semibold tabular-nums" title={punch.open ? "Punch is still open" : punch.worked_minutes + " paid minutes ÷ 60"}>{punch.open ? "—" : punch.worked_hours_display}</span></td>
              <td className={styles.flagsCell}><Flags punch={punch} /></td>
              <td className={styles.actionsCell}><div className="flex items-center justify-end gap-2">
                {canEdit && punch.pending_approval ? <button type="button" disabled={punch.open || punch.on_break || punch.breaks.some((row) => row.open)}
                  onClick={() => { setEditError(""); setApproving({ ...punch, note: "" }); }} aria-label={"Review timecard for " + punch.employee_name + " on " + punch.date_label}
                  title={punch.open || punch.on_break || punch.breaks.some((row) => row.open) ? "Close the punch and all breaks before approving" : "Review and approve recorded hours"}
                  className="rounded bg-[#C8102E]/10 px-2 py-1.5 text-xs font-semibold text-[#C8102E] disabled:opacity-40 dark:text-red-300">Review</button> : null}
                {canEdit ? <button type="button" onClick={() => openEdit(punch)} className="rounded px-1 py-2 text-xs font-semibold text-[#C8102E] dark:text-red-300" aria-label={"Edit punch for " + punch.employee_name + " on " + punch.date_label}>Edit</button> : null}
                <button type="button" aria-label={"Details for " + punch.employee_name + " on " + punch.date_label} aria-expanded={expanded === punch.id} aria-controls={"punch-detail-" + punch.id} onClick={() => setExpanded(expanded === punch.id ? null : punch.id)} className="rounded p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronDown size={16} className={expanded === punch.id ? "rotate-180" : ""} /></button>
              </div></td>
            </tr>
            {expanded === punch.id ? <tr className={styles.detailRow}><td colSpan={7}><div id={"punch-detail-" + punch.id}><PunchDetails punch={punch} />
            </div></td></tr> : null}
          </Fragment>)}</tbody>
        </table>
        {!visiblePunches.length ? <div className="px-4 py-12 text-center text-sm text-zinc-500"><p>{allPunches.length ? "No punches match these filters." : "No punches in this date range."}</p>
          {allPunches.length ? <button type="button" onClick={() => { setPerson(""); setReviewFilter("all"); setSearch(""); }} className="mt-2 font-semibold text-[#C8102E]">Clear filters</button> : null}</div> : null}
      </> : <div className={styles.totalsScroll} tabIndex={0} role="region" aria-label="Employee hour totals"><table className={styles.totalsTable}>
        <caption className="sr-only">Employee totals for the selected date range</caption>
        <thead><tr><th scope="col">Person</th>{["Regular", "Overtime", "Total hours", "Unpaid breaks", "Cleared", "Pending"].map((label) => <th key={label} scope="col" className={styles.numeric}>{label}</th>)}</tr></thead>
        <tbody>{visibleGroups.map((group) => <tr key={group.key}>
          <td><button type="button" onClick={() => { setPerson(String(group.key)); setReviewFilter("all"); setView("punches"); }} className="flex items-center gap-2 text-left font-medium hover:text-[#C8102E]"><EmployeeAvatar name={group.name} src={group.profile_photo_url} size="sm" /><span>{group.name}<span className="block text-[11px] font-normal text-zinc-500">{group.punches.length} punches{group.openCount ? " · " + group.openCount + " open" : ""}</span></span></button></td>
          <td className={styles.numeric}>{group.labor ? (group.labor.regular_minutes / 60).toFixed(2) : "—"}</td>
          <td className={styles.numeric}>{group.labor ? (group.labor.overtime_minutes / 60).toFixed(2) : "—"}</td>
          <td className={styles.numeric + " font-semibold"}>{group.totalDisplay}</td>
          <td className={styles.numeric}>{group.labor ? <>{(group.labor.break_minutes / 60).toFixed(2)}<span className="block text-[11px] text-zinc-500">{group.labor.break_count} breaks</span></> : "—"}</td>
          <td className={styles.numeric + " text-green-800 dark:text-green-300"}>{group.approvedDisplay}</td><td className={styles.numeric + " text-red-800 dark:text-red-300"}>{group.pendingDisplay}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">{selectedPerson || search ? "Filtered total" : "Period total"} (hrs)</th>{["regular_minutes", "overtime_minutes", "totalMinutes", "break_minutes", "approvedMinutes", "pendingMinutes"].map((key) => <td key={key} className={styles.numeric + " font-semibold"}>{(visibleGroups.reduce((sum, group) => sum + (group[key] ?? group.labor?.[key] ?? 0), 0) / 60).toFixed(2)}</td>)}</tr></tfoot>
      </table>{!visibleGroups.length ? <p className="px-4 py-10 text-center text-sm text-zinc-500">No employees in this date range match these filters.</p> : null}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
        <span>{dateLabel(from)} – {dateLabel(to)}</span><span>Export includes all employees in this date range.</span>
      </div>
    </section>

    <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400"><summary className="w-fit cursor-pointer rounded py-1">How hours are calculated</summary>
      <p className="mt-1 max-w-3xl leading-relaxed">Punch timestamps stay exact. Paid hours are paid minutes ÷ 60, shown to two decimals. The two new CSV reports also show two decimals; the original payroll format keeps unrounded hours.
        {payload?.use_break_punches ? " Actual unpaid breaks are subtracted." : payload?.subtract_scheduled_break ? " Scheduled unpaid breaks are subtracted." : " No break deduction is applied."}
        {" "}Overtime starts after 40 paid hours in each Sunday–Saturday workweek, in restaurant time. Earlier hours in the workweek count even for a custom range. Overnight shifts crossing Sunday are split between weeks. Reports select whole shifts by clock-in date. Recorded totals include closed punches awaiting approval. Cleared totals include only payroll-ready hours. Open punches have no hours calculated yet. Export stays on hold until all punches used in the report are closed and cleared.</p>
    </details>
    {!canEdit && payload ? <p className="mt-2 text-xs text-zinc-500">Read-only access. A GM or assistant manager can correct punches.</p> : null}

    {lightbox ? <Modal title={"Punch photos · " + lightbox.employee_name} onClose={() => setLightbox(null)}>
      <p className="mb-3 text-xs text-zinc-500">{lightbox.clock_in_label}</p>
      <div className="grid gap-4 sm:grid-cols-2">{["in", "out"].map((direction) => <div key={direction}>
        <h4 className="mb-2 text-xs font-semibold">Clock {direction}</h4>
        {lightbox["clock_" + direction + "_photo_url"] ? <><img src={lightbox["clock_" + direction + "_photo_url"]} alt={"Clock-" + direction + " photo of " + lightbox.employee_name} className="max-h-[55vh] w-full rounded-lg object-contain" />
          {!lightbox["face_detected_" + direction] ? <p className="mt-2 text-xs text-red-700 dark:text-red-300">Face was not detected.</p> : null}</> : <p className="py-8 text-sm text-zinc-500">No clock-{direction} photo</p>}
      </div>)}</div>
    </Modal> : null}

    {approving ? <Modal title="Review flagged timecard" onClose={() => setApproving(null)} busy={saving}>
      <form onSubmit={approveTimecard} className="space-y-3">
        <p className="font-semibold">{approving.employee_name}</p>
        <p className="text-sm">{approving.clock_in_label} to {approving.clock_out_label}</p>
        <p className="text-xs text-zinc-500">Scheduled: {approving.scheduled_label}</p>
        <p className="text-sm font-semibold">{approving.worked_hours_display} recorded hours · {approving.break_minutes} unpaid break minutes</p>
        <ul className="list-inside list-disc text-sm text-red-800 dark:text-red-300">{approving.review_flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
        <Corrections punch={approving} />
        <p className="text-xs leading-relaxed text-zinc-500">Confirm these hours were worked. Approval clears this timecard for payroll and records your name, time, and note. Later changes require a new review.</p>
        <label className="grid gap-1 text-xs font-semibold">Review note<textarea required maxLength={1000} disabled={saving} value={approving.note} onChange={(event) => setApproving({ ...approving, note: event.target.value })} className="rounded-md border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
        {editError ? <p role="alert" className="text-sm text-red-800">{editError}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setApproving(null)} className={buttonClass}>Cancel</button><button type="submit" disabled={saving || !approving.note.trim()} className="rounded-md bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : "Approve recorded hours"}</button></div>
      </form>
    </Modal> : null}
    {editing ? <PunchEditor editing={editing} setEditing={setEditing} saving={saving} error={editError} onSave={saveEdit} onCancel={() => setEditing(null)} /> : null}
  </div>;
}
