"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDaysISO, getStoreToday } from '@/lib/store-time';
import { formatLongDate } from '@/lib/schedule';
import { ATTENDANCE_LABELS } from '@/lib/attendance-records';
import { payPeriodFor } from '@/lib/timecard-review';
import AttendanceExport from './AttendanceExport';
import styles from './AttendanceBoard.module.css';

const METRICS = [['late', 'Late'], ['call_out', 'Call-outs'], ['no_show', 'No-shows'], ['left_early', 'Left early']];
const initials = name => name.split(/\s+/).map(word => word[0]).slice(0, 2).join('');
async function request(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load attendance.');
  return data;
}

function NoteEditor({ note, onSave, busy }) {
  const [value, setValue] = useState(note.note || '');
  return <details className={styles.note}>
    <summary>{note.note || 'Add manager note'}<span>{note.label}</span></summary>
    <form onSubmit={event => { event.preventDefault(); onSave(value); }}>
      <label>Manager note<textarea value={value} onChange={event => setValue(event.target.value)} rows={2} maxLength={2000} /></label>
      <button type="submit" disabled={busy || value === (note.note || '')}>Save note</button>
    </form>
  </details>;
}

export default function AttendanceBoard() {
  const today = getStoreToday();
  const [range, setRange] = useState(() => ({ from: addDaysISO(today, -29), to: today }));
  const [custom, setCustom] = useState(range);
  const [period, setPeriod] = useState('30');
  const [report, setReport] = useState(null);
  const [employeeId, setEmployeeId] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [manual, setManual] = useState({ event_date: today, event_type: 'call_out', note: '' });
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      const data = await request(`/api/attendance/events?${new URLSearchParams(range)}`);
      if (current === sequence.current) setReport(data);
    } catch (err) {
      if (current === sequence.current) { setError(err.message); setReport(null); }
    } finally { if (current === sequence.current) setLoading(false); }
  }, [range]);
  useEffect(() => { load(); return () => { sequence.current += 1; }; }, [load]);
  const people = useMemo(() => (report?.employees || []).filter(person => person.name.toLowerCase().includes(search.trim().toLowerCase())), [report, search]);
  const selected = people.find(person => person.id === employeeId) || people[0];
  const history = selected?.records.filter(record => view === 'all' || record.flags.length || record.ambiguous || record.status === 'Needs matching') || [];
  const serverToday = report?.today || today;
  function choosePeriod(value) {
    setPeriod(value); setMessage('');
    if (value === 'custom') { setCustom({ from: range.from, to: range.to > serverToday ? serverToday : range.to }); return; }
    if (value === 'payperiod') { setRange(payPeriodFor(serverToday)); return; }
    setRange({ from: addDaysISO(serverToday, -(Number(value) - 1)), to: serverToday });
  }
  function movePayPeriod(direction) {
    setRange(payPeriodFor(addDaysISO(range.from, direction * 14))); setMessage('');
  }
  async function mutate(url, body, method, success) {
    setBusy(true); setError(''); setMessage('');
    try {
      await request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load(); setMessage(success); return true;
    } catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }
  async function addManual(event) {
    event.preventDefault();
    if (!selected || selected.id.startsWith('unmatched:')) return;
    if (await mutate('/api/attendance/events', { ...manual, employee_id: selected.id, employee_name: selected.name }, 'POST', 'Attendance entry saved.')) {
      setManualOpen(false); setManual(previous => ({ ...previous, note: '' }));
    }
  }
  const disabled = loading || busy;
  return <section className={styles.page} aria-label="Employee attendance workspace">
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>TIME CLOCK / EMPLOYEE WORKSPACE</p><h1>Attendance</h1><p>One employee. Their schedule, punches, and attendance story.</p></div>
      <div className={styles.actions}><a className={styles.button} href="/timeclock/timecards">Timecards ↗</a><button disabled={disabled} onClick={() => mutate('/api/attendance/rescan', range, 'POST', 'Attendance refreshed from the current schedule and punches.')}>{busy ? 'Saving…' : 'Refresh attendance'}</button><button className={styles.primary} aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>{exportOpen ? 'Close export' : 'Export attendance'}</button></div>
    </header>
    <div className={styles.toolbar}>
      <div className={styles.periods} aria-label="Attendance period"><button aria-pressed={period === 'payperiod'} disabled={busy} onClick={() => choosePeriod('payperiod')}>Pay period</button>{[30, 60, 90].map(days => <button key={days} aria-pressed={period === String(days)} disabled={busy} onClick={() => choosePeriod(String(days))}>{days} days</button>)}<button aria-pressed={period === 'custom'} disabled={busy} onClick={() => choosePeriod('custom')}>Custom</button></div>
      <span>{formatLongDate(range.from)} – {formatLongDate(range.to)}{range.to > serverToday ? ` · Through ${formatLongDate(serverToday)}` : ''}</span>
    </div>
    {period === 'payperiod' && <div className={styles.payPeriodNav}><button disabled={disabled} onClick={() => movePayPeriod(-1)}>← Previous pay period</button><span>14-day payroll period</span><button disabled={disabled || addDaysISO(range.from, 14) > serverToday} onClick={() => movePayPeriod(1)}>Next pay period →</button></div>}
    {period === 'custom' && <form className={styles.custom} onSubmit={event => { event.preventDefault(); setRange({ ...custom }); setMessage(''); }}>
      <label>From<input type="date" required max={custom.to < serverToday ? custom.to : serverToday} value={custom.from} onChange={event => setCustom({ ...custom, from: event.target.value })} /></label>
      <label>Through<input type="date" required min={custom.from} max={serverToday} value={custom.to} onChange={event => setCustom({ ...custom, to: event.target.value })} /></label>
      <button disabled={disabled} type="submit">Apply dates</button>
    </form>}
    <p className={styles.rule}><span aria-hidden="true">✓</span> Future shifts are excluded. No-shows count only after a published shift ends with no matching punch or call-out.</p>
    {exportOpen && <AttendanceExport range={range} through={serverToday} employees={report?.employees || []} currentEmployee={selected} disabled={disabled} />}
    {error && <p className={styles.error} role="alert">{error} <button onClick={load} disabled={disabled}>Try again</button></p>}
    {message && <p className={styles.message} role="status">{message}</p>}
    <div className={styles.workspace} aria-busy={loading}>
      <aside className={styles.directory} aria-label="Employee directory">
        <div className={styles.directoryHead}><h2>Employees <span>{report?.employees.length || 0}</span></h2><label className={styles.search}><span className={styles.srOnly}>Search employees</span><input type="search" placeholder="Search employees…" value={search} onChange={event => { setSearch(event.target.value); setManualOpen(false); }} /></label></div>
        <div className={styles.employeeList}>{people.map(person => <button key={person.id} className={styles.employee} aria-pressed={person.id === selected?.id} disabled={busy} onClick={() => { setEmployeeId(person.id); setManualOpen(false); setView('all'); }}>
          <span className={styles.avatar}>{initials(person.name)}</span><span className={styles.personText}><strong>{person.name}</strong><span>{person.matching_count ? `${person.matching_count} to match` : person.exception_count ? `${person.exception_count} attendance ${person.exception_count === 1 ? 'flag' : 'flags'}` : 'No attendance flags'}{!person.active ? ' · Inactive' : ''}</span></span><span className={styles.chevron} aria-hidden="true">›</span>
        </button>)}{!people.length && <p className={styles.empty}>{loading ? 'Loading employees…' : search ? 'No employees match your search.' : 'No employees to display.'}</p>}</div>
      </aside>
      <div className={styles.detail}>
        {loading ? <div className={styles.empty} role="status">Matching schedules and punches…</div> : !selected ? <div className={styles.empty}>Choose an employee to see their attendance.</div> : <>
          <header className={styles.personHeader}><span className={`${styles.avatar} ${styles.largeAvatar}`}>{initials(selected.name)}</span><div><p className={styles.eyebrow}>EMPLOYEE ATTENDANCE</p><h2>{selected.name}</h2><p>{selected.completed} completed {selected.completed === 1 ? 'shift' : 'shifts'} in this period{!selected.active ? ' · Inactive employee' : ''}</p></div><button className={styles.primary} disabled={disabled || selected.id.startsWith('unmatched:')} aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)}>{manualOpen ? 'Close entry' : '+ Add entry'}</button></header>
          <div className={styles.metrics}>{METRICS.map(([type, label]) => <div key={type}><span>{label}</span><strong data-alert={selected.counts[type] > 0}>{selected.counts[type]}</strong></div>)}</div>
          {(selected.counts.clock_in_early > 0 || selected.counts.unscheduled > 0) && <p className={styles.otherCounts}>{selected.counts.clock_in_early} early clock-ins <span>·</span> {selected.counts.unscheduled} unscheduled punches</p>}
          {manualOpen && <form className={styles.manual} onSubmit={addManual}><h3>Add attendance for {selected.name}</h3><div className={styles.formRow}><label>Date<input type="date" required max={serverToday} value={manual.event_date} onChange={event => setManual({ ...manual, event_date: event.target.value })} /></label><label>Attendance type<select value={manual.event_type} onChange={event => setManual({ ...manual, event_type: event.target.value })}>{Object.entries(ATTENDANCE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label></div><label>Manager note<textarea rows={2} placeholder="What happened?" maxLength={2000} value={manual.note} onChange={event => setManual({ ...manual, note: event.target.value })} /></label><button type="submit" className={styles.primary} disabled={disabled}>Save entry</button></form>}
          <div className={styles.historyHeader}><h3>Attendance history</h3><div className={styles.periods}><button aria-pressed={view === 'all'} onClick={() => setView('all')}>All activity</button><button aria-pressed={view === 'flags'} onClick={() => setView('flags')}>Flags only</button></div></div>
          <div className={styles.history}>{history.map(record => <article key={record.id} className={styles.record}>
            <div className={styles.date}><strong>{formatLongDate(record.date)}</strong><span>{record.role || 'Attendance'}</span></div>
            <div className={styles.evidence}><div className={styles.badges}>{record.flags.length ? record.flags.map(flag => <span key={flag.key} className={styles.badge} data-tone={flag.event_type === 'no_show' ? 'red' : 'amber'}>{flag.label}{flag.minutes_delta ? ` · ${flag.minutes_delta} min` : ''}</span>) : <span className={styles.badge} data-tone={record.status === 'Worked' ? 'green' : 'neutral'}>{record.status}</span>}{record.flags.length > 0 && record.actual.length > 0 && <span className={styles.worked}>{record.completed ? 'Worked' : 'Clocked in'}</span>}</div>
              <div className={styles.times}><div><span>Scheduled</span><strong>{record.scheduled_label}</strong></div><div><span>Actual punches</span>{record.actual.length ? record.actual.map(punch => <strong key={punch.id}>{punch.label}</strong>) : <strong className={styles.muted}>{record.ambiguous ? 'Punch found · match needed' : 'No punch recorded'}</strong>}</div></div>
              {record.schedule_state !== 'published' && <p className={styles.context}>{record.schedule_state === 'draft' ? 'Draft schedule' : 'No published schedule'} · automatic attendance flags are not counted.</p>}
              {record.ambiguous && <p className={styles.context}>A punch overlaps more than one shift. Check the timecard before assigning attendance.</p>}
              {record.notes.map(note => <NoteEditor key={`${note.id}:${note.note}`} note={note} busy={disabled} onSave={value => mutate(`/api/attendance/events/${note.id}`, { note: value }, 'PATCH', 'Manager note saved.')} />)}
              {record.flags.filter(flag => !record.notes.some(note => note.id && note.id === flag.id)).map(flag => <NoteEditor key={flag.key} note={{ note: '', label: `${flag.label} · manager note` }} busy={disabled} onSave={value => flag.id ? mutate(`/api/attendance/events/${flag.id}`, { note: value }, 'PATCH', 'Manager note saved.') : mutate('/api/attendance/events', { ...flag, note: value, generated_note: true }, 'POST', 'Manager note saved.')} />)}
            </div>
          </article>)}</div>
          {!history.length && <div className={styles.empty}>{view === 'flags' ? 'No attendance flags in this period.' : 'No past shifts, punches, or attendance entries in this period.'}</div>}
          <p className={styles.footer}>Times shown in restaurant time · Draft and upcoming shifts never count as no-shows.</p>
        </>}
      </div>
    </div>
  </section>;
}
