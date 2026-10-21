# Store equipment, manuals, and recurring work

## Implementation

Database → Equipment contains each selected store's equipment register. Equipment records have a name, manufacturer, model, serial number, location, service contact, notes, and service status. Managers with `database.manage` (assistant manager or GM) can edit equipment, attach multiple PDF manuals, and maintain cleaning and maintenance schedules. Crew can read the register and manuals.

The original six library tabs stay editable and store-specific. Learner Hub belongs in Training; SOP, Schedule, Manual, and other tags describe resource types. Equipment pages hold the actual asset records and schedules. No equipment inventory, manufacturer procedures, or maintenance intervals are invented or seeded.

## Store setup and access

The store selector is available in Database and equipment pages. An organization administrator can add a store with its name, optional number, and time zone. Creation gives that administrator GM access, six default library tabs, and empty equipment and checklist data. It does not copy employees, documents, completions, or historical data from another store.

Store access lets a store GM or organization administrator grant, change, or disable access for existing active employee accounts within the organization. An employee can switch among authorized stores or choose the store when signing in with their PIN. Ambiguous PIN matches are rejected. Creating new employee accounts continues to use the existing employee administration workflow.

The migration bootstraps the existing operator's stores into one organization. Existing active Payson GMs become its initial organization administrators. Newly created store managers do not automatically become organization administrators.

Home-store memberships initially follow the employee role maintained by the existing People workflow. Fresh access checks update that role and honor inactive employees and revoked memberships. An explicit assignment in Store access becomes a separately managed store role. A transferred employee's automatic home membership does not authorize access to their former store.

Database, equipment, and checklists use the selected store. Other Hub modules still use their established store configuration, so secondary-store sessions are restricted to the supported areas. This change does not make payroll, scheduling, inventory, or other legacy modules multi-store.

## Schedules and completion history

- Cleaning and maintenance schedules repeat every 1–365 days, weeks, or months from a first due date, with an AM/PM shift and minimum responsible role.
- Dates use the selected store's time zone. A monthly schedule anchored on the 31st uses February's last day and returns to the 31st when available.
- Due occurrences are materialized transactionally when equipment or checklists are read. The next read catches up missed dates; no scheduler or external automation is required.
- Equipment work appears in its own section of the existing daily Checklists screen. Past-due tasks remain available until completed or cancelled. Completion stores the employee's name, actual completion time, local completion date, and optional notes.
- Editing a schedule cancels/replaces pending work due today or later. Past-due records and completed records retain their original equipment name, task title, instructions, and role. Completed occurrences are not generated again for the same schedule, date, and shift.
- Pausing a schedule cancels outstanding work while retaining history. Resuming starts from today and follows the original anchor without backfilling the paused period.
- Out-of-service and retired equipment stop generating work and cancel outstanding tasks. Manuals and completed history remain available. Returning equipment to service resumes from today.
- Equipment and schedule edits use version checks to reject stale saves. Completion is idempotent and cannot overwrite an earlier completion.

Equipment history is stored in `hub_equipment_tasks`; classic checklist tasks and reports remain in their existing tables. Equipment history is available on each equipment page.

## PDFs and storage

Equipment manuals accept PDFs up to 50 MiB each. The browser checks the PDF header and uploads directly through a signed Supabase Storage ticket, avoiding the application request-size limit. Finalization verifies the stored size and content type. Ready files are downloaded through a fresh store authorization check and a 60-second signed URL. Object paths remain server-side except for the narrowly scoped upload ticket.

The `equipment-documents` bucket is private. New tables and RPCs are service-only, with RLS and explicit revocation of anonymous/authenticated access. Every API resolves active store membership from the database rather than trusting client store/actor fields or the role copied into a session. Manual removal archives its metadata and hides the file; it does not delete the stored object bytes.

## Release setup

The equipment library requires these migrations in order:

1. `20261021194821_hub_resource_library.sql`
2. `20261021194842_resource_tabs_and_tags.sql`
3. `20261021194843_store_equipment_and_schedules.sql`

Use the existing Supabase server credentials and session secret. The UI shows a setup error until the schema is available. Login verifies hashed PINs, retains the shared attempt limiter, and requires the store schema. Store access rechecks active managed roles and memberships; operations do not fall back to unverified access.

## Validation

Run focused unit/server-boundary checks with:

```sh
node --import ./tests/resolve-local.mjs --test tests/resources.test.mjs tests/equipment.test.mjs
```

`scripts/validate-equipment-postgres.cjs` applies all three migrations to a disposable PGlite database and tests onboarding, memberships, revocation, isolation, calendar recurrence, edits, completion history, pause/resume, lifecycle changes, and SQL permissions. It requires the optional `@electric-sql/pglite` package, or `PGLITE_MODULE` pointing to an installed module. It does not connect to Supabase.

Browser validation uses isolated API fixtures against the local application, including signed-upload requests, store switching, access controls, desktop/mobile rendering, checklist completion, and schedule history. These UI checks do not verify a live Supabase bucket; production storage is checked separately during release.

`scripts/validate-equipment-storage.mjs` is an explicit live release check. With approved production server credentials, it verifies a signed upload accepts exactly 50 MiB and rejects 50 MiB plus one byte, then deletes its temporary objects through the Storage API and verifies cleanup. It does not create equipment or checklist records.

`scripts/validate-equipment-browser.cjs` requires optional Playwright and installed Chrome. Start a local server using `https://resources-preview.invalid` for the public Supabase URL, dummy Supabase keys, and `local-resource-preview-only` as the test session secret. Set `PLAYWRIGHT_MODULE` to an installed module if necessary; `EQUIPMENT_PREVIEW_URL` defaults to `http://localhost:3121`. Use an isolated local preview, never a production URL. The script intercepts API data and private upload requests with disposable fixtures.
