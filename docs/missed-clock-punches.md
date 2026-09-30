# Missed clock and break punches

The registered store iPad offers actions after employee PIN verification:

- Clocked out: Clock In and Forgot to clock in.
- Clocked in: Clock Out, Start Break, Forgot to clock out, and Forgot to start break. Break actions follow the attendance setting.
- On break: End Break and Forgot to end break.

Employees enter a restaurant-local date/time and a reason. Saving updates their status immediately and stores a correction history entry in the same database transaction. The server checks the current punch and break against the identified state, rejects future times, times older than seven days, overlapping shifts and invalid break ordering, and requires the registered device, unlocked kiosk and employee PIN. Every missed-punch action requires a new JPEG photo before submission. The private correction photo, face-detection result, and capture timestamp are saved with the correction in one database transaction. The server timestamp records when the correction photo was submitted, separately from the employee’s claimed missed time; historical entries do not fabricate a photo or manager authorization for the original event. A missed clock-in is explicitly recorded as unscheduled for review.

GM/AM review uses the existing Hub Timecards screen and its Red flags awaiting approval filter. It displays every correction type, claimed time and reason. Correction history participates in the immutable timecard review snapshot; later changes invalidate the prior approval. Open shifts/breaks cannot be approved, and unresolved flagged timecards block payroll export while preserving recorded hours. `timecard_approvals` is the authoritative approval record; legacy `punch_corrections.status` is not used to determine payroll readiness.

Validation uses synthetic employees only: state choices, restaurant timezone parsing, atomic status/audit updates, paid-minute calculations, duplicate/stale submissions, invalid ordering, restricted database function access, HTTP device/PIN/ownership/origin checks, timecard approval invalidation, and the existing clock security suite. Production employee punches are not created for testing.

Migration: `20260929180900_missed_clock_corrections.sql`. Deploy migration before the Hub and clock builds. Both Vercel projects follow GitHub main; clock output remains `.next-clock`.
