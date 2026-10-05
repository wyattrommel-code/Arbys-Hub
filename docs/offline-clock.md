# Store iPad offline clock

The dedicated clock site prepares a public offline app shell and an IndexedDB queue after the authorized iPad connects and a manager unlocks it. The Hub and sales sandbox do not get an offline clock.

## Store use

- Open the clock while online and wait for **Ready for offline clocking**. Use Safari’s **Add to Home Screen** and keep this app open on the store iPad.
- During a connection failure, employees choose their name, enter their PIN, select clock in/out or a break, and take a photo. Missed punches still require an actual time, reason and photo. A success message appears only after the event and JPEG have committed to IndexedDB.
- The local roster changes immediately. The banner shows punches waiting on the iPad. Do not clear Safari website data, remove the app, reset or replace the iPad while punches are waiting.
- The app attempts upload on reconnect, focus, reopening and every 30 seconds while open. iPadOS may suspend closed/background apps; syncing resumes when the clock is opened. Background Sync is not a requirement.
- Normal offline clock-ins outside a scheduled shift can include a manager PIN. PINs are verified on reconnect; while offline, the clock explicitly says they are awaiting verification.
- Applied offline punches retain their original capture time, update the timecard, and require payroll review. Failed PINs, overlaps, edited shifts and other conflicts appear under **Time clock → Offline review** with the photo, claimed time, receipt time and issue. Managers can enter a note and **Apply saved punch**, using the saved time and photo after checking the evidence. Conflicting records may need a timecard correction first. **Mark handled** records a resolution note without changing hours. Unresolved offline records hold payroll export for the affected period.

## Limits and recovery

An online preparation authorizes offline capture for 72 hours. Refreshing while connected renews this period. Initial pairing, unlocking a never-prepared browser, and renewal after expiry require internet. Revocation prevents uploads and further preparation; previously saved evidence is never erased automatically. If a station is revoked with pending punches, restore/reconcile it with technical support before pairing another browser.

The queue holds up to 500 pending punches including JPEGs. Storage errors fail visibly without claiming that a punch was saved. Safari storage is device-local, not a backup; persistence is requested but the OS/user can still clear it. Keep the dedicated iPad powered and use the Home Screen app. Validate Wi-Fi off/on, reload and camera use on the actual iPad before relying on this operationally.

## Implementation and security

- The public service worker caches only the clock shell and Next static assets, never API responses, payroll pages or punch photos. Roster/state and queued JPEGs use IndexedDB, scoped to the clock origin.
- No employee PIN list or password hash is downloaded. Entered PINs are RSA-OAEP encrypted using a public key; the private key stays in an RLS-protected service-only table. Cleartext PINs are held only during the current entry flow and are not logged.
- A 72-hour HMAC lease is bound to the paired device credential. Upload still requires the current registered device and kiosk authorization. Device enrollment remains browser authorization, not hardware attestation. The lease cannot revoke local capture before a disconnected iPad reconnects.
- Event UUIDs, photo hashes, a request fingerprint and a transaction receipt prevent duplicates when the response is lost. Upload order and local parent references preserve clock-in → break → clock-out sequences. Receipts survive client retries. A local photo is removed only after server acknowledgement and a refreshed roster.
- Each event uses the server-time offset from the last snapshot; both capture time and receipt time are retained. Incorrect device time, old records or state conflicts go to manager review rather than overwriting current data. A device clock is not tamper-proof.
- The migration adds restricted key and event tables, an invoker-only transaction function and an offline audit source. Deploy the migration before the Hub and clock code. No production schema/data change is part of local validation.

References: [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [MDN Background Sync availability](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API).
