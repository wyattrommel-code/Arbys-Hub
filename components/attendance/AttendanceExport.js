"use client";

import { useState } from 'react';
import { formatLongDate } from '@/lib/schedule';
import styles from './AttendanceBoard.module.css';

export default function AttendanceExport({ range, through, employees, currentEmployee, disabled }) {
  const [scope, setScope] = useState('all');
  const [type, setType] = useState('summary');
  const [selectedIds, setSelectedIds] = useState(() => currentEmployee ? [currentEmployee.id] : []);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [feedbackFor, setFeedbackFor] = useState('');
  const availableIds = selectedIds.filter(id => employees.some(person => person.id === id));
  const shown = employees.filter(person => person.name.toLowerCase().includes(search.trim().toLowerCase()));
  const count = scope === 'all' ? employees.length : availableIds.length;
  const feedbackKey = JSON.stringify([range.from, range.to, type, scope, scope === 'selected' ? availableIds : []]);

  async function download(event) {
    event.preventDefault(); setExporting(true); setError(''); setMessage(''); setFeedbackFor(feedbackKey);
    try {
      const params = new URLSearchParams({ ...range, type, scope });
      if (scope === 'selected') availableIds.forEach(id => params.append('employee_id', id));
      const response = await fetch(`/api/attendance/export?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not export attendance. Try again.');
      }
      if (!response.headers.get('Content-Type')?.includes('text/csv')) throw new Error('Your session may have expired. Sign in again before exporting.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `attendance-${type}-${range.from}-to-${range.to}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`CSV download started for ${count} ${count === 1 ? 'employee' : 'employees'}.`);
    } catch (err) { setError(err.message); }
    finally { setExporting(false); }
  }

  return <form className={styles.exportPanel} onSubmit={download} aria-label="Export attendance">
    <div className={styles.exportHeading}><h2>Export attendance</h2><p>{formatLongDate(range.from)} – {formatLongDate(range.to)}{range.to > through ? ` · Data through ${formatLongDate(through)}` : ''}</p></div>
    <div className={styles.exportFields}>
      <label>Report format<select value={type} disabled={exporting} onChange={event => setType(event.target.value)}><option value="summary">Employee summary (CSV)</option><option value="details">Detailed attendance (CSV)</option></select></label>
      <label>Employees to export<select value={scope} disabled={exporting} onChange={event => setScope(event.target.value)}><option value="all">Everyone ({employees.length})</option><option value="selected">Choose employees</option></select></label>
      <button className={styles.primary} type="submit" disabled={disabled || exporting || !count}>{exporting ? 'Preparing CSV…' : `Download ${type === 'summary' ? 'summary' : 'details'}`}</button>
    </div>
    {scope === 'selected' && <fieldset className={styles.exportPeople}><legend>Select one or more employees · {availableIds.length} selected</legend>
      <div className={styles.exportSearch}><input aria-label="Find employees to export" type="search" placeholder="Find employees…" value={search} onChange={event => setSearch(event.target.value)} />{currentEmployee && <button type="button" disabled={exporting} onClick={() => { setSelectedIds([currentEmployee.id]); setSearch(''); }}>Only {currentEmployee.name}</button>}<button type="button" disabled={exporting} onClick={() => setSelectedIds([])}>Clear selection</button></div>
      <div className={styles.exportChecklist}>{shown.map(person => <label key={person.id}><input type="checkbox" checked={availableIds.includes(person.id)} disabled={exporting} onChange={event => setSelectedIds(previous => event.target.checked ? [...new Set([...previous, person.id])] : previous.filter(id => id !== person.id))} /><span>{person.name}</span></label>)}{!shown.length && <p>No employees match your search.</p>}</div>
    </fieldset>}
    <p className={styles.exportHint}>{type === 'summary' ? 'One row per employee with attendance counts and a period total.' : 'Each attendance record with scheduled times, actual punches, flags, and manager notes.'} Includes all activity for the chosen dates and employees.</p>
    {feedbackFor === feedbackKey && error && <p className={styles.error} role="alert">{error}</p>}{feedbackFor === feedbackKey && message && <p className={styles.message} role="status">{message}</p>}
  </form>;
}
