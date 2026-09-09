# Hub data access security cutover

## Release status

This change prepares the application and database security cutover. It has not
changed the live database. Do not apply the migration independently of the matching
application release: the old browser-direct client and plaintext PIN lookup will
stop working after the migration.

The reviewed base (`e8ce9ba`) imported a nonexistent `PunchFixes` component.
This change removes that import and render reference to unblock the security
release; it does not implement a new punch-correction feature. The production
build now passes with non-secret placeholder Supabase configuration. Existing
lint failures remain. A staging acceptance pass and coordinated application
deployment are still prerequisites for the live cutover.

## Access model

The app keeps its signed, HTTP-only employee cookies. Every data request rechecks
the employee's current active status and effective roles. Inactive roles confer no
access; database lookup failures deny access. Role claims in an old cookie are not
authority for database operations.

The browser Supabase client and embedded roast sheet send their table requests to
`/api/data/[table]`. That endpoint explicitly checks table, operation, columns,
employee ownership, and the existing Payson store identifiers before using the
server-only service credential. It rejects arbitrary RPCs, schema selection,
relationship embedding (except the existing safe role projection), credential
filters, and unsupported operations. Dedicated workflow endpoints remain responsible
for checklist, role, attendance, clock and timecard mutations.

The migration revokes public/anonymous/authenticated grants, including separate
column privileges, and removes permissive public-table policies. RLS remains on.
Browser authentication does not use Supabase Auth JWTs, so granting access to the
`authenticated` Postgres role would not authenticate an employee in this app.
Service-role authorization must always occur in server code before data access.

| Data or action | Allowed access |
|---|---|
| Basic active employee directory | Logged-in staff; contact details/notes omitted |
| Employee PIN/hash | Never returned to a browser; GM may set a replacement PIN |
| Wages, imported labor costs, people management, imports, checklist reports | GM |
| Role assignments and role administration | Existing GM-only mutation endpoints |
| Roast entries, tempering, inventory counts and waste submissions | Logged-in staff, with restricted mutation methods |
| Schedule builder/templates/stations and deployment submission | Shift lead or above |
| Crew schedule and punch reads | Their own employee ID; schedule weeks must be published |
| Crew availability | Their own records, without cross-employee upsert takeover |
| Time-off creation | Requesting employee, always pending |
| Time-off review | Shift lead or above; reviewer identity comes from the session |
| Checklist completion edits/removal | Original employee or GM |
| Checklist photo/signature requirements | Enforced by the server upload/completion paths |
| Employee punch photos | Their owner, or staff with full time-clock access |
| Profile photos | Logged-in staff or an authorized time-clock kiosk |
| Checklist photos | Logged-in staff at this restaurant |

This is still a single-restaurant application. `07462` and `payson` are existing
aliases for the same store. Do not treat this policy as a complete multi-store
tenant model; several existing tables have no store column.

## Visible changes

- The roast sheet requires Hub login.
- Imports require GM access because they expose wage and labor-cost inputs.
- Existing PINs are hashed in place with salted bcrypt. The GM can reset a PIN but
  cannot reveal the old one. A blank PIN in the employee edit form keeps it unchanged.
- Shared PIN-attempt limits run in Postgres, with 60 attempts per client and 120
  overall per five-minute window. A Vercel-supplied IP is HMACed with the session
  secret before use; raw IP addresses are not stored. Other deployments use one
  shared client bucket until a trusted proxy is configured.
- A shift lead or manager unlocks the time clock for up to the existing eight-hour
  session duration. This kiosk cookie grants clock access only, not Hub management
  access. Each punch/break still requires the employee PIN. The unlocking employee's
  active status and current authority are rechecked. Automatic hardcoded employee
  promotion has been removed.
- Old cookies have no purpose claim and are rejected on this release; staff sign
  in again. A kiosk token cannot be substituted for a Hub token.
- Photos use private buckets and authenticated, non-cacheable application URLs.
  Uploaded records retain their existing storage paths; no photos are deleted.
- Cross-origin API mutations are rejected. API JSON and photo responses are private
  and non-cacheable. Framing is restricted to the same origin, preserving the roast
  iframe.

Four-digit PINs remain a limited-strength credential. This change blocks direct
data access and slows online guessing; it does not turn a PIN into strong manager
authentication or invalidate any PIN someone may previously have learned. A reset
does not revoke already issued cookies by itself; deactivate the employee or rotate
the session secret when immediate session revocation is required. Longer manager
credentials/MFA and individual session management are follow-up decisions.

## Validation

Requires Node 24 for the test runner hooks. PGlite is pinned as a development-only
dependency; no external database or production credentials are used by these tests.

```sh
npm ci --ignore-scripts
npm run test:security
npm run test:security:http
```

The first command set includes policy, session and ownership tests plus a local
PostgreSQL/pgcrypto migration test with synthetic employee records. It verifies
record preservation, denial of anonymous/authenticated reads and writes, removal
of column grants, private storage policies, PIN migration/reset/login, inactive
employees, rate limits and safe defaults for future objects.

The HTTP test runs real Next.js route handlers against a synthetic local backend.
It checks unauthenticated access, stale GM claims, deactivated employees, hidden
PIN selection, CSRF, own-record filters, kiosk cookie separation, and photo access.
Its backend is a fixture, not a full Supabase installation. The PostgreSQL test is
also a fixture, not a complete reproduction of the live schema. Staging checks
below remain necessary.

Both run in a separate GitHub security job, independent of the pre-existing lint
job. Local targeted lint passed for the new security modules and API changes.
The production build passes locally with placeholder configuration and is included
in the security CI job. This proves compilation and prerendering, not connectivity
to the production backend. The full application still reports its baseline lint
errors; full lint is not represented as passing.

The live advisor baseline reported the existing mutable search path on
`set_updated_at`; the migration sets it explicitly. The existing checklist tables'
no-policy notices are consistent with server-only access, not an instruction to
add allow-all policies. [Search-path guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
and [no-policy guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Coordinated release

1. Confirm the build check passes for the release commit. Confirm the production
   branch and deployment target; GitHub's default
   `master` differs from the active `main` branch.
2. Confirm a recoverable database backup and the matching release artifact. The
   migration preserves records but intentionally makes PIN hashing irreversible.
   Do not export plaintext PINs into a rollback script, logs or repository files.
3. Run the migration and matching application against an isolated staging project
   with the real schema and synthetic staff. Check GM and crew login, PIN reset,
   kiosk unlock, punch/break authorization, roster projections, photo upload/view,
   checklist ownership, a roast save and availability submission.
4. Check server-only `SUPABASE_SERVICE_ROLE_KEY` and a strong `SESSION_SECRET` are
   set. Keep production credentials out of untrusted preview deployments. No new
   secret values are provided or committed in this change.
5. During a coordinated maintenance window, stop old-client writes, apply
   `supabase/migrations/20260908210505_secure_hub_data_access.sql` and promote the
   matching application. Do not direct the old standalone roast app at the newly
   restricted database; users should use the authenticated Hub sheet.
6. Verify unauthenticated table reads/writes/RPC calls fail, all three buckets are
   private, previously public photo URLs no longer download, and legitimate crew
   and GM operations succeed. Check any previously cached public-photo URLs too.
   Re-run Supabase's security advisor and the read-only verification SQL below.
7. If the release fails after migration, keep public access closed and repair the
   compatible server application or reset affected credentials through an
   authorized administrator. Rolling back to the old browser-direct application
   alone is not a safe recovery strategy.

```sql
select schemaname, tablename, policyname from pg_policies where schemaname='public';
select id, public from storage.buckets
where id in ('profile-photos','punch-photos','checklist-photos');
select table_name, privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated','PUBLIC');
select table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema='public' and grantee in ('anon','authenticated','PUBLIC');
select count(*) as remaining_plaintext_pins from public.employees
where employee_code !~ '^\$2[aby]\$';
```

Design references: [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api),
[secure-by-default grant change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
and [Vercel trusted request headers](https://vercel.com/docs/headers/request-headers).
