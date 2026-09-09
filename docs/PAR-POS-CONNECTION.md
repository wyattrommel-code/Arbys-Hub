# PAR POS connection

The Import page contains **PAR POS · Connected Sales**, restricted to current GMs using the existing server session checks. Select a business date and **Sync sales**. The server reads Sales2.GetOrders; it never submits an order or payment to PAR.

## Credentials and switching locations

Open Vercel → **arbys-hub** → **Settings → Environment Variables**, select **Production**, edit the following values, and redeploy the project. “Production” here means the live Hub deployment; the PAR connection remains a sandbox until `BRINK_ENVIRONMENT` changes.

| Variable | Current purpose |
| --- | --- |
| `BRINK_ACCESS_TOKEN` | PAR account access token; store as Secret |
| `BRINK_LOCATION_TOKEN` | PAR location token; store as Secret |
| `BRINK_API_HOST` | Assigned hostname only; sandbox is `api-apiint.brinkpos.net` |
| `BRINK_ENVIRONMENT` | `sandbox` now; `production` for the actual assigned store |
| `BRINK_LOCATION_LABEL` | Display name, currently `API Lab-01` |
| `BRINK_SYNC_ENABLED` | `true` enables the daily job; `false` pauses it |
| `BRINK_PUBLISH_HOURLY_SALES` | `false` keeps review data separate; production-only `true` updates hourly store sales |
| `CRON_SECRET` | Independently generated 32+ character secret protecting the scheduler |

Routine access-token rotation needs only a token edit and redeploy. Changing the location token, host, or environment starts a separate connection history automatically. Existing snapshots remain stored, but the panel displays only the active connection. Never add `NEXT_PUBLIC_` to these variables or commit an actual `.env` file. Never put PAR tokens into Supabase client settings, browser code, query strings, or logs.

For the actual store, replace the two tokens and assigned hostname together, set environment to `production`, and update the label. Initially retain publishing `false`, sync a completed business day, and compare with the POS report. Enable publishing only after totals and business-date interpretation match. No code changes are needed for a supported PAR host.

## Schedule and data behavior

Vercel cron runs once daily in the 12:00 UTC hour (roughly 6 AM MDT / 5 AM MST, with Hobby scheduling variation). It imports the previous Payson calendar date as the business date. Manual sync supports today and the previous 90 days. The setup uses the existing Hobby plan; no upgrade or new paid service is required. The register must have uploaded its sales to PAR. Historical edits or a missed daily sync can be recovered with the date selector; automatic backfill is not implemented.

PAR requests are separated by a database-enforced two-minute cooldown across app instances. GET status reads the saved snapshot without calling PAR. Failed requests keep the last successful snapshot. Each successful GetOrders response atomically replaces its connection/date snapshot; rerunning a date cannot add duplicate sales. The scheduler and manual button share the same lock.

Only closed, nonempty orders contribute to totals. Refund amounts retain PAR's signs. Hourly net sales use the order-opening timestamp in America/Denver, under PAR's returned business date. PAR's WCF DateTimeOffset timestamps contain a UTC DateTime and separate OffsetMinutes; the parser reads the UTC instant without applying the offset twice. Long order IDs remain strings to avoid rounding. Order-level net sales are used rather than summing combo components. Customer identities, card details, payment tokens, and raw SOAP are not stored.

Sandbox results never write `hourly_sales`, `roast_entries`, or forecasts. In production with explicit publishing enabled, all 24 `hourly_sales` buckets for the selected date are replaced atomically, including zeros, so CSV and API totals are not added together. This first integration does not update the CSV import's next-week forecast or legacy roast daily-total fields. Continue the existing forecast workflow until that mapping is separately validated. Avoid CSV-importing the same dates while API publishing is enabled, since both replace hourly totals.

## Storage and security

`brink_sales_days` holds sanitized order snapshots and summaries. `brink_sync_state` holds sync times, a concurrency token, and sanitized error messages. Both tables have RLS enabled and no browser access grants. The existing general Data API cannot access them. Only the server service role can call `brink_claim_sync` and `brink_finish_sync`; both functions are security invoker, with a fixed search path and PUBLIC execution revoked. Sandbox publication is also rejected inside the database transaction.

Supabase's informational “RLS enabled, no policy” notice is intentional for these server-only tables. [Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Verification and operation

- `npm run test:brink`: SOAP parsing, missing/error responses, ID precision, refund/open-order totals, safe host selection, key rotation, secret handling, database isolation and duplicate prevention.
- `npm run test:security:http`: real route authorization, including anonymous and crew rejection for this integration and unauthenticated scheduler rejection.
- `npm run build`: production Next.js build.

To pause scheduled imports, set `BRINK_SYNC_ENABLED=false` and redeploy. To stop publishing real totals while retaining connection tests, set `BRINK_PUBLISH_HOURLY_SALES=false` and redeploy. Failed cron invocations appear in Vercel logs and a PAR error appears on the Import panel; email notifications are not configured. Production PAR permissions and vendor certification remain separate from sandbox success.

References: [PAR GetOrders](https://developers.partech.com/docs/parpos-cloud-apis/soap/sales2/post/GetOrders), [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
