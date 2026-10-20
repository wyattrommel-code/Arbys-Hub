"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { contrastText, formatClock, formatHours, formatLongDate, minutesToTime } from "@/lib/schedule";
import { adjustShiftWindow, layoutDayShifts, shiftWindow, windowFields } from "@/lib/schedule-day";
import styles from "./ScheduleDayView.module.css";

function timeLabel(minutes) {
  return `${formatClock(minutesToTime(minutes))}${minutes >= 1440 ? " (+1 day)" : ""}`;
}

export default function ScheduleDayView({ date, rows, shiftsByRowDay, hoursByRow, colorFor, warningsFor, locked, saving, onCreate, onEdit, onChange }) {
  const [overnight, setOvernight] = useState(false);
  const [preview, setPreview] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const gesture = useRef(null);
  const tracks = useRef(new Map());
  const scroller = useRef(null);
  const suppressClick = useRef(false);
  const positioned = useRef(false);
  const entries = useMemo(() => rows.map((employee) => {
    const shifts = shiftsByRowDay.get(`${employee.id}|${date}`) || [];
    return { employee, shifts, cards: layoutDayShifts(shifts) };
  }), [rows, shiftsByRowDay, date]);
  const timelineEnd = Math.max(overnight ? 1800 : 1440, ...entries.flatMap(({ cards }) => cards.map((card) => Math.ceil(card.end / 60) * 60)));
  const hours = Array.from({ length: timelineEnd / 60 }, (_, i) => i);
  const total = entries.reduce((sum, row) => sum + row.shifts.reduce((n, shift) => n + Number(shift.scheduled_hours || 0), 0), 0);

  useEffect(() => {
    if (positioned.current || !scroller.current) return;
    positioned.current = true;
    const starts = entries.flatMap(({ cards }) => cards.map((card) => card.start));
    const earliest = starts.length ? Math.min(...starts) : 9 * 60;
    const track = tracks.current.values().next().value;
    if (track && scroller.current.scrollWidth > scroller.current.clientWidth) {
      scroller.current.scrollLeft = Math.max(0, earliest - 60) / timelineEnd * track.clientWidth;
    }
  }, [entries, timelineEnd]);

  useEffect(() => {
    const cancel = (event) => {
      if (event.key === "Escape" && gesture.current) {
        gesture.current = null;
        suppressClick.current = true;
        setPreview(null);
        setAnnouncement("Change cancelled.");
      }
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, []);

  function begin(event, shift, employee) {
    if (event.button !== 0 || !event.isPrimary || locked || saving || String(shift.id).startsWith("temp-")) return;
    const action = event.target.closest("[data-resize]")?.dataset.resize || "move";
    const track = tracks.current.get(employee.id);
    if (!track) return;
    suppressClick.current = false;
    gesture.current = {
      shift, employee, action, original: shiftWindow(shift),
      x: event.clientX, y: event.clientY, width: track.getBoundingClientRect().width,
      scrollLeft: scroller.current.scrollLeft,
      copy: action === "move" && (event.ctrlKey || event.metaKey), active: false,
    };
    // Capture on the actual button so a tap still dispatches its normal click.
    (event.target.closest("button") || event.currentTarget).setPointerCapture(event.pointerId);
  }

  function updateGesture(event) {
    const current = gesture.current;
    if (!current) return null;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return null;
    current.active = true;
    suppressClick.current = true;
    const box = scroller.current.getBoundingClientRect();
    if (event.clientX > box.right - 28) scroller.current.scrollLeft += 12;
    else if (event.clientX < box.left + 170) scroller.current.scrollLeft -= 12;
    // The page remains the only vertical scroll area; keep distant rows reachable.
    if (event.clientY > window.innerHeight - 32) window.scrollBy(0, 12);
    else if (event.clientY < 40) window.scrollBy(0, -12);
    const delta = (event.clientX - current.x + scroller.current.scrollLeft - current.scrollLeft) / current.width * timelineEnd;
    let employee = current.employee;
    let valid = event.clientX >= box.left && event.clientX <= box.right;
    if (current.action === "move") {
      employee = rows.find((row) => {
        const rect = tracks.current.get(row.id)?.getBoundingClientRect();
        return rect && event.clientY >= rect.top && event.clientY < rect.bottom;
      });
      valid = valid && Boolean(employee) && (!employee.isSynthetic || employee.id === current.employee.id);
    }
    const next = {
      ...current, employee: employee || current.employee, valid,
      ...adjustShiftWindow(current.original, current.action, delta, timelineEnd),
    };
    setPreview(next);
    return next;
  }

  async function finish(event) {
    const current = gesture.current;
    if (!current) return;
    const next = current.active ? updateGesture(event) : null;
    gesture.current = null;
    setPreview(null);
    if (!next) return;
    if (!next.valid || locked || saving) {
      setAnnouncement("Change cancelled. Drop the shift on an employee row.");
      return;
    }
    if (!next.copy && next.start === current.original.start && next.end === current.original.end && next.employee.id === current.employee.id) return;
    const ok = await onChange(current.shift.id, next.employee, windowFields(next, current.shift.unpaid_break_minutes), next.copy);
    setAnnouncement(ok ? `${next.copy ? "Copied" : "Updated"} shift for ${next.employee.fullName}: ${timeLabel(next.start)} to ${timeLabel(next.end)}.` : "Could not save. The original shift has been restored.");
  }

  function cancelGesture() {
    if (!gesture.current) return;
    suppressClick.current = gesture.current.active;
    gesture.current = null;
    setPreview(null);
  }

  async function keyboardResize(event, shift, employee, action) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || locked || saving) return;
    event.preventDefault();
    const window = adjustShiftWindow(shiftWindow(shift), action, event.key === "ArrowLeft" ? -15 : 15, timelineEnd);
    const ok = await onChange(shift.id, employee, windowFields(window, shift.unpaid_break_minutes), false);
    setAnnouncement(ok ? `Shift now ${timeLabel(window.start)} to ${timeLabel(window.end)}.` : "Could not save. The original shift has been restored.");
  }

  function cardStyle(shift, start, end, lane = 0) {
    const color = colorFor(shift.role);
    return {
      left: `${start / timelineEnd * 100}%`, width: `${Math.max(15, end - start) / timelineEnd * 100}%`,
      top: 7 + lane * 44, background: color, color: contrastText(color),
    };
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="font-semibold">{formatLongDate(date)} · {formatHours(total)} scheduled</p>
        <label className="schedule-no-print flex items-center gap-2">
          <input type="checkbox" checked={overnight} disabled={Boolean(preview) || saving} onChange={(event) => setOvernight(event.target.checked)} className="accent-[#C8102E]" />
          Show overnight hours
        </label>
      </div>
      <p id="day-drag-help" className="schedule-no-print mb-2 text-xs text-zinc-500">
        Drag a shift to change its time or employee. Drag either edge to resize. Ctrl/Cmd-drag to copy. Changes snap to 15 minutes; click for exact times. Esc cancels.
      </p>
      <div className={`schedule-print-grid ${styles.scroller}`} ref={scroller} aria-label={`Schedule for ${formatLongDate(date)}`} aria-busy={saving}>
        <div className={styles.timeline} style={{ "--hour-count": hours.length, minWidth: 216 + hours.length * 38 }}>
          <div className={`${styles.row} ${styles.heading}`}>
            <div className={styles.employee}>Employee</div>
            <div className={styles.axis}>
              {hours.map((hour) => <span key={hour}>{hour >= 24 ? "+1 " : ""}{hour % 12 || 12}{hour % 24 < 12 ? "a" : "p"}</span>)}
            </div>
            <div className={styles.total}>Day hours</div>
          </div>
          {entries.map(({ employee, shifts, cards }) => {
            const dailyHours = shifts.reduce((sum, shift) => sum + Number(shift.scheduled_hours || 0), 0);
            const weekHours = hoursByRow.get(employee.id) || 0;
            const active = preview?.employee.id === employee.id && preview.valid;
            return (
              <div key={employee.id} className={styles.row} style={{ minHeight: Math.max(56, 12 + (Math.max(0, ...cards.map((card) => card.lane)) + 1) * 44) }}>
                <div className={styles.employee}>
                  <span>{employee.fullName}</span>
                  <span className={styles.weekHours}>{formatHours(weekHours)} week {weekHours > 40 ? <span title="Over 40 hours this week">⚠️</span> : null}</span>
                </div>
                <div
                  ref={(node) => { if (node) tracks.current.set(employee.id, node); else tracks.current.delete(employee.id); }}
                  className={`${styles.track} ${active ? styles.target : ""}`}
                  data-day-row={employee.id}
                  onClick={(event) => {
                    if (event.target.closest("[data-day-shift]")) return;
                    if (suppressClick.current) { suppressClick.current = false; return; }
                    if (locked || saving || employee.isSynthetic) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const minute = Math.max(0, Math.min(1425, Math.round((event.clientX - rect.left) / rect.width * timelineEnd / 15) * 15));
                    onCreate(employee, date, minutesToTime(minute));
                  }}
                >
                  {cards.map(({ shift, start, end, lane }) => {
                    const warnings = warningsFor(shift, employee);
                    const disabled = locked || saving || String(shift.id).startsWith("temp-");
                    const label = `${employee.fullName}, ${shift.role || "No role"}, ${timeLabel(start)}–${timeLabel(end)}`;
                    return (
                      <div key={shift.id} data-day-shift={shift.id} className={`${styles.card} ${preview?.shift.id === shift.id && !preview.copy ? styles.origin : ""}`} style={cardStyle(shift, start, end, lane)}
                        onPointerDown={(event) => begin(event, shift, employee)} onPointerMove={updateGesture} onPointerUp={finish}
                        onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}>
                        <button type="button" data-resize="start" className={styles.handle} disabled={disabled} aria-label={`Adjust start: ${label}`} title="Drag start; use left/right arrows for 15 minutes"
                          onKeyDown={(event) => keyboardResize(event, shift, employee, "start")} onClick={(event) => event.stopPropagation()}><span /></button>
                        <button type="button" className={styles.cardBody} disabled={disabled} aria-label={`Edit ${label}`} aria-describedby="day-drag-help" title={`${label}${shift.station ? ` · ${shift.station}` : ""}${warnings.length ? ` · ${warnings.join(" · ")}` : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressClick.current) { suppressClick.current = false; return; }
                            onEdit(shift);
                          }}>
                          {warnings.length ? <span aria-label={warnings.join(". ")}>⚠️ </span> : null}
                          <strong>{shift.role || "No role"}</strong> <span>{formatClock(shift.scheduled_start)}–{formatClock(shift.scheduled_end)}{end > 1440 ? " +1" : ""}</span>
                        </button>
                        <button type="button" data-resize="end" className={styles.handle} disabled={disabled} aria-label={`Adjust end: ${label}`} title="Drag end; use left/right arrows for 15 minutes"
                          onKeyDown={(event) => keyboardResize(event, shift, employee, "end")} onClick={(event) => event.stopPropagation()}><span /></button>
                      </div>
                    );
                  })}
                  {active ? <div className={`${styles.card} ${styles.ghost}`} style={cardStyle(preview.shift, preview.start, preview.end)}>
                    <span>{preview.copy ? "+ " : ""}{preview.shift.role || "No role"} · {timeLabel(preview.start)}–{timeLabel(preview.end)}</span>
                  </div> : null}
                </div>
                <div className={styles.total}>
                  <span>{formatHours(dailyHours)}</span>
                  {!locked && !employee.isSynthetic ? <button type="button" disabled={saving} onClick={() => onCreate(employee, date)} aria-label={`Add shift for ${employee.fullName}`} className={styles.add}>+</button> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
