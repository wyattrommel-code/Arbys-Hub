# Clock-in work reasons and coverage

Release approved October 14, 2026. Local validation is complete. Production verification must confirm the database migration, both deployed revisions, and the paired-iPad workflow described below.

When an employee has no remaining eligible scheduled shift, the paired store clock asks whether they are covering someone, working extra hours, or reporting an incorrect schedule. All three choices retain employee PIN verification, GM/assistant manager authorization, and a required photo. Opening the clock and clocking out or taking a break retain their existing rules.

Coverage uses another employee's published, available shift. The manager confirms agreed coverage hours and the original employee's attendance outcome. The punch belongs to the person actually working; the covered shift is stored separately. Attendance compares the worker's punch to the agreed hours. Coverage alone leaves the original absence intact. An approved swap releases that shift obligation; a recorded call-out remains a call-out.

Extra hours and approved coverage have neutral labels in attendance and timecards. Schedule problems and ambiguous historical records show a small Check timecard action. Historical punches are not assigned invented work reasons. Attendance exports include work type and coverage details; payroll calculations are unchanged.

Offline work reasons travel with the saved punch and photo. Employee and manager PINs must already be prepared on the iPad and are checked before queueing. Sync validates current authorization and coverage, applies accepted events once, and preserves conflicting events for manager review. Applying a held event retains its work reason. Offline schedule availability is a snapshot: conflicting work recorded elsewhere can still require review when the iPad reconnects.

## Validation

- 62 relevant tests passed across attendance, exports, clock routes, coverage SQL, offline queue/replay, offline PINs, timecard review, and deployment route guards.
- The new SQL migration was executed in isolated PGlite tests with restricted browser roles and service-role execution, including rejected conflicts, idempotent offline replay, and applying held replacement coverage.
- Hub and clock production Webpack builds passed with placeholder environment values.
- Focused ESLint completed with zero errors; two existing image-element warnings remain in TimecardsBoard.
- The real clock form and attendance board were checked in a local preview with synthetic records, including the iPad-width layout. This is not a physical iPad or production punch test.

## Release sequence after approval

1. Apply the additive `20261013222727_clock_work_reasons.sql` migration to the connected production database before releasing the code that reads its new column or calls its functions.
2. Publish the reviewed code to both Hub and store-clock Vercel projects and verify their deployed revisions and punch routes.
3. Refresh the paired store iPad while online so its code and offline schedule/authorization snapshot are current. Existing saved offline events remain compatible.
4. During an authorized real employee shift, verify the manager/photo flow, stored employee identity and coverage context, attendance display, and offline reconnect behavior on the paired iPad. Do not create disposable payroll punches in production.

The migration is additive and retains the old offline functions. A code rollback can leave the new column/functions in place without deleting any timecard evidence.
