# Employee attendance workspace

Attendance is a current comparison of schedules and punches, not a list of every flag ever saved. The workspace lists employees, including active employees with no flags, and shows each person's counts, scheduled times, actual punches, and manager notes. Date filters use restaurant time and stop at today.

## Matching and absence rules

- Employee IDs take priority. Legacy records can use a unique exact Jolt ID or full name; last-name similarity is never sufficient.
- A same-employee punch overlapping one shift matches even without a stored `shift_id`. Explicit links disambiguate overlapping shifts. Several punches inside one shift use the first arrival and final departure.
- A punch overlapping multiple possible shifts is marked **Needs matching**. An explicit link outside the shift's time window also needs inspection. Neither is automatically treated as an absence.
- A no-show requires a published, assigned shift that has ended in restaurant time and has no matching punch or call-out. Draft weeks, missing publication records, future dates, and later shifts today cannot create automatic absence flags.
- Overnight shifts and DST use real timestamps. An old unclosed punch cannot clear every later day's attendance.
- A punch awaiting payroll approval still proves attendance. Schedule deviations are compared to the configured grace periods independently of payroll approval.

## Reconciliation and notes

The GET route is read-only and recalculates against current source records, so imports and corrections immediately stop stale automatic flags from appearing in counts. Refresh attendance and post-punch scans use the same comparison. Unchanged events are not rewritten. Obsolete automatic events without notes are removed during a scan; manager entries and notes are retained. A conflicting manual no-show is shown as a historical manager entry without counting it as a current absence.

Adding a note to a derived flag revalidates the evidence and retains automatic status. A later punch correction can clear the flag while preserving the note. Existing note edits and manual attendance entry remain available.

No attendance operation changes punch IDs, schedule links on payroll punches, timestamps, photos, approvals, hours, or pay. No schema migration is required. All data routes retain the existing `timeclock.full` feature authorization and store scope. Reads are paginated to avoid truncating busy periods.

## Attendance exports

Select a pay period (with previous/next period controls), the last 30/60/90 days, or custom dates. Pay periods use the same Sunday-based 14-day boundaries as timecards. A current period keeps its full end date in the export title while **Data through** shows today's cutoff; future shifts are excluded.

**Export attendance** offers an employee-summary CSV (counts per person plus a period total) and a detailed CSV (schedule, exact punch times including seconds, flags, and manager notes). Export everyone or select one or more employees. Directory searches and the Flags only view do not silently restrict the export. Selections are explicit, and invalid employee IDs fail rather than falling back to everyone.

Exports use the read-only attendance projection, preserve the workspace's corrected matching, and retain `timeclock.full` authorization and store scoping. These attendance reports do not change payroll approval requirements. CSV values are escaped, spreadsheet formulas are neutralized, and the response is private/non-cacheable.

## Validation

Run `node --import ./tests/resolve-local.mjs --test tests/attendance-export.test.mjs tests/attendance.test.mjs` for report totals, single/multiple employee isolation, pay-period/rolling windows, exact punch times, note escaping, authorization, and matching regressions.

Run `node --import ./tests/resolve-local.mjs --test tests/attendance.test.mjs` for matching, publication/future cutoffs, identity collisions, split/overnight shifts, DST, pagination, stale flags, note preservation, and scan idempotency. The October 11 regression fixture uses the reported unlinked 9:13 a.m.–4:21 p.m. punch against a 9 a.m.–5 p.m. shift.
