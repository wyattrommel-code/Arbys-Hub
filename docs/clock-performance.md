# Clock capture performance

The kiosk verifies the selected employee's PIN with `hub_verify_employee_pin`
instead of trying bcrypt across the active roster. The existing PIN-only lookup
remains for manager authorization, where a manager has not selected their name.
Both paths still require device authorization and the database-backed PIN limit.
The new function is executable only by the server's service role and rejects
inactive/terminated employees, other stores, malformed PINs, and mismatched PINs.

Apply `20261007214117_clock_employee_pin_lookup.sql` before deploying the Hub
code. The clock and Hub use the same repository; publish the approved change to
both Vercel projects. This migration adds a function and changes no timecards,
PINs, photos, or employee records. A previous app version can ignore the function.
Do not publish or apply the production migration until the user approves release.

The selected-name screen warms the shared camera while the PIN is entered, for
at most 20 seconds. No photo is taken during warmup. The existing idle-track and
background/page-exit cleanup still apply. The camera requests 640 x 480 at 15 fps
(24 max), preserves the full frame, and sets minimum optical/browser zoom once
per acquired stream. Uploaded JPEGs are capped at a 720-pixel longest edge with
0.72 quality; the server still requires photos before accepting required punches.

Native face detection is used when available. Otherwise MediaPipe initialization
and inference run in a Web Worker on supported browsers, one small transferable
bitmap at a time. The worker releases each bitmap. Detection failure/timeouts
cannot block capture or report a face that was not detected. There is no visible
face circle or camera coaching text. Model/WASM asset URLs are unchanged.

Preparing an offline PIN verifier happens after successful online verification
without holding up the action screen. A valid existing verifier is reused only
when the server's device/employee/PIN version matches. A changed PIN derives a
new salted verifier. Offline capture still checks the entered PIN, throttles
wrong attempts, and requires a durable photo queue before showing success.

Only the live clock display rerenders each second. Independent backend reads
run together, and employee role queries are limited to authorization decisions.

## Verification on October 7, 2026

- Hub and store-clock production builds passed with the locked dependencies.
  Changed-file ESLint, `git diff --check`, and the final production clock smoke
  test passed. Camera, offline, corrections, database, and HTTP security tests
  passed across the targeted runs.
- Read-only database comparison using a synthetic nonmatching value: the active
  roster hash scan took 1752.901 ms; the selected-ID query used the primary-key
  index and took 74.578 ms. This is a query benchmark, not full clock-in timing.
  The comparison was made before applying the new production function.
- Synthetic browser fixture with the real camera component: regular clock-in,
  clock-out, and missed-time photos reached the mocked request in 32, 23, and
  33 ms respectively (about 13 KB each), using a single camera acquisition.
  MediaPipe's worker loaded successfully and completed inference. No console
  errors were reported. Checked 1024 x 768 and 768 x 1024 layouts.
- Database authorization, PIN invalidation/throttling, mandatory correction
  photos, worker errors, durable offline queues, retry/idempotency, and clock
  route isolation are covered by the existing tests extended for this change.
- Browser camera/network data were synthetic, not real employee punches. The
  temporary development fixture was removed. These timings do not measure an
  actual iPad camera, Wi-Fi upload, or full end-to-end production response.

After release, check a normal employee clock-in and clock-out on the store iPad,
including full-frame portrait/landscape photos, a missed punch, and offline sync.

After user approval, the production migration was applied on October 7, 2026.
Its generated migration version is reflected in the filename. Verified that
only `service_role` has execute access, the function uses invoker security,
and a nonexistent employee is rejected. The database security advisor reported
no new findings (the same existing informational RLS-with-no-policy notices for
server-only tables).
