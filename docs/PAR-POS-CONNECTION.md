# PAR POS connection

The Import page automatically refreshes saved sales and exposes a GM-only API call log with evidence downloads.

## Credentials and switching locations

Open Vercel → **arbys-hub** → **Settings → Environment Variables**, select **Production**, edit the following values, and redeploy the project. “Production” here means the live Hub deployment; the PAR connection remains a sandbox until `BRINK_ENVIRONMENT` changes.

| Variable | Current purpose |
| --- | --- |
| `BRINK_ACCESS_TOKEN` | PAR account access token; store as Secret |
| `BRINK_LOCATION_TOKEN` | PAR location token; store as Secret |
| `BRINK_API_HOST` | Assigned hostname only; sandbox is `api-apiint.brinkpos.net` |
| `BRINK_ENVIRONMENT` | `sandbox` now; `production` for the actual assigned store |
| `BRINK_LOCATION_LABEL` | Display name, currently `API Lab-01` |
| `BRINK_SYNC_ENABLED` | `true` permits automation; `false` is a server-level stop |
| `BRINK_PUBLISH_HOURLY_SALES` | `false` keeps review data separate; production-only `true` updates hourly store sales |
| `CRON_SECRET` | Independently generated 32+ character secret protecting the scheduler |

Routine access-token rotation needs only a token edit and redeploy. Changing the location token, host, or environment starts a separate connection history automatically. Existing snapshots remain stored, but the panel displays only the active connection. Never add `NEXT_PUBLIC_` to these variables or commit an actual `.env` file. Never put PAR tokens into Supabase client settings, browser code, query strings, or logs.

For the actual store, replace the two tokens and assigned hostname together, set environment to `production`, and update the label. Initially retain publishing `false`, sync a completed business day, and compare with the POS report. Enable publishing only after totals and business-date interpretation match. No code changes are needed for a supported PAR host.


After changing location/host/environment, review the new label and enable automatic sync for that connection. After rotating CRON_SECRET, enable automation again to update its Vault copy.

# API methods, frequency, and operating behavior

## Services and requests

| Method | Purpose | Frequency | Inputs |
| --- | --- | --- | --- |
| Sales2.GetOrders | Read orders opened on the requested business date | One automatic request per three-minute scheduler tick, with occasional manual historical recovery sharing the same cooldown | BusinessDate; ExcludeOpenOrders=false; default PriceRollUp (RollUp) |
| Sales2.GetCurrentBusinessDate | Initial setup verification | Already called manually during setup; not polled by the Hub. Any future use must remain at most once per three hours per location per PAR guidance. | No request parameters |

Transport: HTTPS POST, SOAP 1.1. Configured sandbox endpoint: `https://api-apiint.brinkpos.net/Sales2.svc`.

GetOrders SOAPAction: `http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders`.

AccessToken and LocationToken are sent only as server-to-server HTTP headers. They are excluded from this package and from the call log. Credentials and the assigned host are configurable in Vercel environment settings. Requests reject redirects; hosts are limited to supported PAR domains and checked against sandbox/production mode. Request timeout is 45 seconds; maximum response body is 20 MiB. There are no immediate retry loops.

## Automatic scheduling

Supabase pg_cron in the existing Arby's project invokes one fixed Vercel endpoint every three minutes via pg_net. The scheduler bearer secret is stored encrypted in Supabase Vault. PAR credentials remain in Vercel. The scheduler runs without an open browser; Vercel's former daily job is removed to avoid competing schedules. Maximum planned automatic GetOrders volume is 480 requests per 24 hours, per configured location.

One database claim across all server instances prevents requests less than two minutes apart, including manual recovery. Three-minute scheduling provides extra time for response processing. A conflicting tick is skipped, not retried immediately. The UI refreshes saved status and call metadata every 30 seconds while visible; those refreshes do not call PAR.

From midnight to 4 AM America/Denver, automatic sync requests yesterday's business date for overnight closing activity. Otherwise it requests today's date. After 6 AM it uses one tick to reconcile yesterday once, then resumes today's reads. A newly enabled connection after 6 AM may use its first tick for yesterday. The initial implementation uses this store-time rule rather than automatically polling GetCurrentBusinessDate; PAR should validate it against the register's end-of-day settings.

This is near-real-time polling, not instant push delivery. Register-to-PAR upload delay, request timing, service failures, or cooldown can delay display. No SOAP webhook for this configured integration has been verified. If PAR requires faster updates, obtain its approved event-driven/incremental approach before changing frequency.

## Persistence and calculations

A successful request atomically replaces the connection/date snapshot. Repeated order IDs cannot duplicate totals. Closed, nonempty orders contribute to sales; open orders are retained but excluded from completed totals. Order-level NetSales avoids double-counting combo components. Refund values retain the signs returned by PAR. WCF DateTimeOffset.DateTime is interpreted as UTC; OffsetMinutes is not applied twice. Hourly buckets use America/Denver and the order's opening time.

Sandbox data never updates real hourly sales or roast/forecast tables. Production has a separate explicit `BRINK_PUBLISH_HOURLY_SALES=true` opt-in, which replaces all 24 hourly buckets for the selected date. Forecast generation and legacy roast daily-total fields are not part of this release. CSV imports remain available, but overlapping production CSV/API dates require an agreed source of truth before publishing.

## Request log and evidence

Before contacting PAR, the Hub writes a call record containing ID, connection, environment, date, source, operation, endpoint, start time and exact request XML without authentication headers. Completion adds end time, duration, HTTP status, PAR result code, response byte count/hash, order count, net sales and sanitized errors.

Response evidence is parsed, allowlisted, and regenerated as namespace-normalized XML. Customer names/IDs, freeform notes, card/payment tokens and unknown fields are excluded. It is clearly labeled **sanitized XML, not an unmodified raw response**. Valid responses up to 64 KiB after sanitizing retain XML; larger ones retain a size-omission marker, byte count and SHA-256 hash. Non-XML/HTTP-error bodies are not archived. Detailed response XML expires after 24 hours; metadata/request history after 30 days. Export the relevant evidence before that window. Logs begin with this release; earlier requests are represented only by the saved setup evidence, not reconstructed logs.

If execution ends unexpectedly after sending a request, its pre-existing “started” record remains visible as incomplete; daily maintenance marks requests older than five minutes as incomplete errors. Logging failures before the request stop the outbound call. A failure to finish logging after sales persistence can leave an error/incomplete log even when the snapshot was saved; compare the snapshot timestamp and call ID when investigating.

Only current GMs may view/export logs or change automatic-sync settings. Public/employee database access is revoked and RLS enabled. The general Hub data endpoint does not expose these tables. The scheduler has a bearer-secret gate; cookies alone cannot invoke it. State-changing UI endpoints enforce same-origin requests.

## Operations, limits, and approval questions

- No subscriptions, paid branches, or paid services were added. Work uses existing Supabase/Vercel allocations. Higher call volume consumes their existing usage quotas; full-day response size should be measured during realistic testing.
- The first sales sync is successful; the test matrix tracks additional live cases separately.
- Ask PAR to confirm three-minute full-day reads, preferred incremental ModifiedTime usage, overnight business-date handling, and whether sanitized XML suffices for validation or a supervised raw sandbox trace is required.
- Labor, employee-name synchronization, order writes and voice analytics are not included.
- Pause with the Hub's “Pause automatic sync” control. After changing CRON_SECRET, re-enable automation to update Vault. After changing location/host, enable the new connection after checking its label. Pausing does not delete stored evidence or sales.
