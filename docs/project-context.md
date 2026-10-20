# Arby's Hub: recovered project context

Reviewed September 28, 2026. This document reconciles the project handoff PDFs,
release records, related tasks, current GitHub main, and a read-only live-page check.

## Application and source

- Live Hub: https://arbys-hub.vercel.app
- Current live employee clock: https://arbys-hub.vercel.app/clock (scheduled for replacement by a separate clock Vercel project).
- Timecards: https://arbys-hub.vercel.app/timeclock/timecards
- Repository: https://github.com/wyattrommel-code/Arbys-Hub
- Active branch: `main`. Do not use the older `master` as the current implementation.
- Fetched main on this review: `6595e9375bbfb77b9fa6ad1a04d14092c0602bb4`.
- This desktop checkout remains at `e8ce9ba`, 18 commits behind that main revision.
  It contains pre-existing uncommitted correction/navigation/timecard work. Do not
  overwrite it or deploy it as the current Hub. Use an isolated current-main checkout
  for new implementation, then review any older work separately before porting it.
- `app/.vercel/project.json` names `arbys-roastbeef`; this nested legacy link is not
  evidence that it is the current Hub deployment target.
- The live `/clock` page was opened on September 28 and showed `Unlock time clock`,
  a manager PIN field, and the shift-lead/manager unlock description. No PIN or
  employee punch was submitted. The Vercel CLI token was invalid, so this review
  did not independently establish the exact commit serving that hostname.

## Decisions recovered from the handoff

The September 24 master guide and Segment 09 already record a dedicated store iPad.
Device enrollment/restriction was paused until Wyatt had the iPad. Wyatt confirmed
on September 28 that the iPad is now available. A native Google Play application
was not selected as a prerequisite. Personal-phone punching is not the requested flow.

The current Hub already has a separate `/clock` page and a signed `hub_kiosk`
cookie, distinct from the normal Hub login. An eligible shift lead or manager
unlocks it for the existing eight-hour session. `getKioskActor` rechecks the
unlocking employee's current active status and effective access. Employee PINs are
still required for clock actions. Unscheduled work requires GM/assistant-manager
authorization. This is not yet a registered-device or physical-location restriction.

Preserve the September 9 security release: server-only data access, hashed PINs,
shared attempt limits, current-role checks, private photos, same-origin mutations,
and purpose-separated sessions. Older comments about public photos are stale.

Preserve the later timecard review implementation: recorded hours remain visible;
GM/assistant-manager approvals are audited and bound to a review snapshot; changes
invalidate approval; open/unresolved punches block the period's payroll export.
Approval does not erase work and is not a payroll-provider integration.

## Meaning of sandbox

PAR/Brink API Lab-01 is the external sales integration's sandbox. It supplies test
orders, discounts, destinations and POS-account IDs. Its snapshots remain separate
from real store sales/forecast totals. It is not a global Hub sandbox mode.

The Hub employee roster, schedules, punches, breaks, attendance and timecards use
their own operational records. They do not depend on PAR's employee-directory
lookup or production approval. Kitchen station timing remains a separate unvalidated
integration; HME timer data and planned audio/transcription are separate sources.

The user explicitly wants clock-in/out excluded from any sales/timer sandbox.
Do not make timekeeping wait for PAR production cutover or connect its authorization
to `BRINK_ENVIRONMENT`.

## Correct continuation for the iPad

1. Start from current `main`, preserving the dirty desktop checkout.
2. Extend `lib/security/kiosk.js` and the existing unlock flow. Avoid a second
   parallel kiosk/session implementation.
3. Add server-managed device enrollment and revocation, with a GM-controlled
   approval of the particular iPad browser. Treat enrollment as distinct from daily
   shift unlock. A one-use, short-lived pairing challenge is preferable to a shared
   long-lived activation key; record who approved the device and when.
4. Require the active device credential on roster/identify/punch/break and kiosk
   photo paths, as well as on unlock. Preserve current actor, PIN, photo, store and
   timecard checks. A manager PIN on a personal phone must not suffice.
5. Decide separately whether to require the restaurant network or geofence as well.
   Browser enrollment does not prove physical location or provide hardware
   attestation. Guided Access and a Home Screen bookmark are usability controls.
6. Test allowed iPad use and rejected other-browser requests, revocation, session
   expiry, reboot/browser reset, manager deactivation, duplicate submissions and
   visible photo/network failures. Never create real employee punches merely to
   test development code.
7. Release coordinated Hub backend and separate clock Vercel project builds, then
   enroll in the final iPad browser/Home Screen context. Record release revisions
   and actual store acceptance. See `store-ipad-clock.md` for the implementation and
   release instructions following Wyatt's decision to use a separate Vercel project.

This is the corrected implementation direction, not a claim that device enrollment
has been implemented or deployed. No activation key needs to be entered for the
withdrawn draft.

## Sources and review coverage

Project workspace: `C:/Users/wyatt/OneDrive/Documents/ChatGPT/Arbys`.

- `output/pdf/Arbys_Hub_Documentation/`: master guide and all 19 segment guides,
  corresponding to the 69-page combined print binder. Topics include platform,
  dashboard, roast, checklists, deployment, waste, inventory, scheduling, clock,
  timecards, people, CSV imports, reports, PAR, McLane, HME audio, Hermes,
  equipment and HME timing. All segment text reviewed; complete clock/timecard
  pages also rendered and visually inspected.
- September 8 project review; September 9 security release; September 13 PAR
  eight-page validation sheet; September 14 sync record; September 16 business-date
  record; September 28 six-page PAR validation package; HME NEXEO question sheet.
- Current source docs: `security-cutover.md`, `PAR-POS-CONNECTION.md`, `cogs.md`,
  and `brink-order-details.md`. The September 28 package supersedes the earlier
  unresolved business-date test; it still records the employee-directory error.
- Related tasks: `Analyze Arby’s Roast Beef repo` and
  `# Cursor Prompt: Schedule Builder module`. Historical task instructions are
  context, not automatic permission for new external actions.
- Drive document folder:
  https://drive.google.com/drive/folders/19P0h_TsldrFDxh0jpW3FjiY3potgj4Wm

The September 24 PDFs are dated handoffs, not fresh certification of every workflow.
This review did not execute payroll, change production settings/data, test a physical
iPad, modify PAR, or deploy code.

## Withdrawal of this task's initial draft

The initial draft used the outdated desktop baseline and introduced a separate
180-day activation cookie. It was backed up outside the repository and removed.
Only this task's changes were reversed; earlier uncommitted work was preserved.
Old draft tests/build results do not validate a current-main device implementation.
