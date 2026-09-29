# Dedicated store iPad time clock

Decision: use two Vercel projects from this repository. The Hub is the backend and manager app; the clock project serves only clock-in/out, breaks, manager unlock, and device pairing. Existing timecards, manager approvals, payroll export, employee PINs and private photo storage remain in the Hub. No Google Play app is required for the iPad.

## Authorization

The GM signs into the Hub and opens Settings → Store iPad. A one-use, 80-bit pairing code expires after ten minutes. Enter it on the store iPad in the exact browser/Home Screen app that will be used every day. The backend stores only credential hashes. Pairing replaces the one active browser for store 07462; revoking also cancels pending codes. The browser receives a host-only HttpOnly, Secure, SameSite=Strict credential valid for 180 days. Clear website data or switch browser containers and the GM must pair again.

After pairing, a shift lead or manager unlocks the station for eight hours with the existing scoped kiosk cookie. Every roster, punch, break and kiosk profile-photo request checks the active device plus the unlocker's live employee status and role. Knowing a PIN, possessing a Hub login, or opening the link on a phone does not enroll a device. GM-only pairing controls recheck live authorization. Registration actions are recorded in a private append-only event table.

This enrolls a browser; it is not hardware attestation or a geofence. Keep pairing codes private and the authorized iPad at the restaurant. A GM can intentionally enroll another browser. Physical restrictions such as Guided Access or supervised device management complement this application control.

The clock server has no database or Hub session-signing key. A fixed, narrow gateway forwards only allowed clock endpoints and profile photos to the Hub over HTTPS. It strips Hub login cookies and all caller authorization headers. Its shared server secret is required in addition to the registered device and shift unlock. Mutations require same-origin requests; responses and private photos are never cached. There is no offline punch queue: a punch needs a successful server response.

## Framework security

The implementation pins Next.js and eslint-config-next to 16.3.6. The previous 16.2.3 dependency has published middleware/proxy bypass and other security advisories, so do not deploy this change with that older dependency. References: https://github.com/advisories/GHSA-26hh-7cqf-hhc6 and https://github.com/vercel/next.js/releases/tag/v16.3.6 . Database authorization remains in the route handlers as defense in depth. Pairing attempts use a different rate-limit bucket from employee PIN attempts.

## Vercel configuration

Create a second Vercel project from `wyattrommel-code/Arbys-Hub`, repository root, Next.js framework. Use the same reviewed commit in both projects. Do not use the legacy nested `app/.vercel` link. Keep the Hub's existing `arbys-hub.vercel.app` project.

Hub project environment:
- Existing Supabase and SESSION_SECRET configuration stays on the Hub.
- `CLOCK_ONLY=false`
- `CLOCK_SITE_URL=https://<new-clock-project>.vercel.app`
- `CLOCK_GATEWAY_SECRET=<new random secret, at least 32 characters>`

Clock project environment (server-only):
- `CLOCK_ONLY=true` (set for both build and runtime)
- `HUB_BACKEND_URL=https://arbys-hub.vercel.app` (origin only)
- `CLOCK_GATEWAY_SECRET=<same new secret as Hub>`

Do not import Hub environment variables into the clock project. In particular do not add Supabase, SESSION_SECRET, PAR, cron or Google keys. Do not prefix the gateway secret with NEXT_PUBLIC_. Preview environments must use a separate test backend and secret; do not give unreviewed previews production access. The build output uses `.next-clock` for clock mode, and `.next` for Hub mode.

## Coordinated release

1. Apply `20260928201406_registered_clock_station.sql` to the Hub database after staging verification. It adds private device and audit tables plus a service-only atomic pairing function; it does not alter payroll, employee or punch records.
2. Create/configure the clock Vercel project and both sets of environment variables. Deploy a tested clock build, then the matching Hub build during a planned clock transition. This Hub release disables the old `/clock` punch interface and rejects every unpaired station immediately; employees must use the newly paired iPad before clocking again.
3. In the Hub, GM → Settings → Store iPad → Create pairing code. Enter it on the physical store iPad. Then a manager unlocks for the shift. Configure the iPad to remain on that site and allow its camera.
4. On a personal phone, verify the clock displays pairing and cannot show the roster or punch, even using a manager PIN. Verify a same-origin direct Hub clock API request is denied. Confirm the iPad's authorized flow, using synthetic staging employees for end-to-end punches before release.
5. Verify replacement/revocation and the first real timecard under the restaurant's normal process. The SQL event log is available to server administrators; it contains no PIN, code or cookie secrets.

Before release: confirm the actual Vercel projects/production commit, sign in to Vercel, run both builds and security/timecard tests, and review database advisors after the migration. This document does not claim those external steps have already happened.

The PAR/Brink sandbox remains only the sales integration's test environment. Device enrollment and time punches do not depend on sandbox sales, timers, or sales cutover settings.

## Recovery

If the iPad is lost or misused, revoke it in Hub settings; this invalidates its credential at the next backend check, including any attempt to submit a punch. A page may show stale UI until its next status poll (at most one minute), but actions still reauthorize. Pair the replacement and unlock again. If pairing succeeds but its HTTP response is lost, issue another code and repeat pairing. Never bypass device checks to restore a station.

Keep the private database migration if reverting UI code. Rolling the Hub back to a pre-registration build also restores the old manager-PIN-only authorization behavior, so treat that as a security-impacting rollback, not a safe fix.

## Local verification (September 29, 2026)

- 23 security, database, two-site HTTP, and timecard tests passed using synthetic records. Coverage includes unauthorized devices, pairing replay/expiry, replacement/revocation, live manager deactivation, CSRF, scoped cookies, and pairing/PIN rate-limit separation.
- Production clock smoke test passed: root and `/clock` render, Hub routes return 404, and missing backend configuration fails closed. A local hostname mismatch found by this test was corrected before completion.
- Both Hub and clock builds passed with Next.js 16.3.6 / Turbopack. The Hub build used synthetic public configuration; the clock build and smoke test had no Supabase or Hub session credentials.
- Changed JavaScript files passed ESLint; `git diff --check` passed.
- `npm audit --omit=dev` reported zero vulnerabilities after updating Next.js, ws and baseline-browser-mapping. The full audit still reported five existing development-tool advisories; this is not a claim that all development dependencies are advisory-free.
- No production migration, Vercel deployment, physical-iPad/camera acceptance, or real employee punch was performed. The available Vercel CLI token was invalid and no Vercel MCP deployment capability was connected.

Continuation: restore Vercel authentication, confirm the actual Hub project and team, create the clock project, review/apply the migration, configure environment variables, then follow the coordinated release steps above. Keep the original dirty desktop checkout separate.
