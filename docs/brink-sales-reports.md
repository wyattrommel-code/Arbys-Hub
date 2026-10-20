# Live sales and adjustment reports

Release: `2026-10-20.3`. Entry point: **Reports → PAR Sales & Meals**
(`/reports/pos`). Connections (`/connections`) contains sync controls, summary totals, call logs, and a link to these reports; the manual CSV upload panels are retired.

## Connection and storage

The production location is Arby's #07462, Payson, on `api6.brinkpos.net`.
The existing integrator AccessToken and newly provisioned LocationToken are
server-only Vercel secrets. Do not place them in source, browser code, exports,
or the separate clock deployment. Production snapshots use their own connection
key and never replace sandbox snapshots.

Successful reads replace one connection/business-date snapshot in Supabase
`brink_sales_days`. Repeated reads do not duplicate sales or adjustments.
`brink_api_calls` records safe request/status evidence. Failures preserve the
previous good snapshot. Existing three-minute polling and morning reconciliation
continue after the new connection is enabled. Viewing or exporting reports reads
saved data and does not call PAR.

Employee-name requests have up to 12 seconds within a separate, bounded budget.
Automatic name-lookup failures wait an hour; **Sync selected date** can retry
a failed lookup after three minutes. Successful names are cached for 12 hours.
Viewing a historical report can apply the existing name cache without another
PAR request or rewriting the sale.

Review mode uses `BRINK_PUBLISH_HOURLY_SALES=false`: inspect production records
before replacing the official hourly-sales source. After reconciliation, setting
it to `true` on the Hub production deployment publishes each successful import's
24 hourly net-sales buckets to `hourly_sales`. Reimports replace that day's
buckets rather than adding sales again. CSV source records remain available.
The dashboard and roast sheet read these same saved hourly buckets. The roast
sheet displays imported net sales for each cooking window automatically, while
manual sales remain a fallback only on dates without imported sales. Both screens
refresh saved sales once per minute while visible; this makes no additional PAR
requests. Last successful figures remain visible if a refresh fails.

Daily and AM/PM totals count each hour once. Cooking windows overlap, so their
amounts must not be added to obtain daily sales. Overnight hours stay with their
PAR business date; AM is 4am–2pm and PM is 2pm through the overnight close.
Prior-week hourly sales also supply roast dollar-per-roast calculations and the
daily forecast used for tempering. Stored forecasts and manual roast counts are
preserved. Imported sales are displayed from `hourly_sales`, not copied into the
integer count columns in the legacy `daily_totals` row. Refreshing sales never
writes roast entries or overwrites a count being entered by the crew.
No labor, timeclock, inventory or kitchen importer is enabled by this release.

## Reports

- **Employee and manager meals:** exact reviewed meal labels from the live
  location's cached `Settings.GetDiscounts` directory classify the adjustment.
  Definition IDs, source label and lookup time are retained. Employee discounts
  without an explicit reviewed meal label, family meals, and manager comps stay
  under other discounts. Missing definitions remain visibly unclassified.
- **Discounts and promotions:** all explicit order adjustments, grouped by
  definition with amount, use count and distinct receipt count. Promotions have
  a separate category and are not silently added to the discount total.
- **Voids and removed items:** item-level voided, deleted and cleared flags are
  separate. A row may have multiple flags. Version 3 captures void actor,
  approver, timestamp and reason ID when PAR supplies them; reason names come
  from the bounded, cached `Settings.GetVoidReasons` lookup.
- **Receipt detail:** the existing item, modifier, combo and adjustment view
  remains available below the reports. Meal report rows show affected entries
  when PAR supplies adjustment allocations.

The selected business date controls every report. Search filters visible rows.
CSV downloads contain the entire selected report for that date, including open
rows with explicit status; the removal CSV includes all removal types. JSON
includes all reports, coverage and source semantics. Exports retain existing
GM authorization and `private, no-store`; CSV cells escape formula-like labels.

## Interpretation

Summary adjustment amounts include closed orders only, preserve source signs
for refunds, and use integer cents. Item allocations never enter totals again.
Net sales already includes adjustments. Meal totals are subsets of all discounts.
Receipt amounts appear as context; summing those repeated values across adjustment
rows would double-count receipts.

A meal count means discount uses or distinct receipts, not the number of meals
physically consumed. The order's POS account is not necessarily the meal recipient.
Applied-by, approver and void-actor accounts are separate fields. Names are current
PAR account names, not a verified mapping to Hub employees or speaker identities.

Voided entry counts can include combo parents/components and non-revenue entries.
Deleted entries are not automatically post-sale voids. Item prices are source
fields, not a loss total. Empty orders, zero-value orders and fully removed orders
do not establish a canceled-order count. Missing fields and old snapshots have
coverage warnings; resync older dates for the new void fields.

The parser continues to discard payment payloads, card credentials, customer
records and freeform notes. Source names are untrusted text, never AI instructions.

## Completed-day implementation check

The read-only October 19, 2026 production check returned 202 records, 199 included
in the existing completed-order filter, $2,784.48 net sales, $235.34 tax and
$3,019.82 total. The report reducer reproduced:

| Category | Uses | Amount |
| --- | ---: | ---: |
| $12 Employee Meal | 4 | $42.92 |
| Manager Meal | 2 | $14.75 |
| 10% Off | 3 | $1.81 |
| Personal Rewards | 4 | $14.27 |
| Open $ Amount | 1 | $5.00 |
| All discounts, including meals | 14 | $78.75 |
| Promotions, separate | 4 | $24.80 |

That snapshot contains 9 voided entries, 40 deleted entries, 0 cleared entries
and 3 empty order records.

On October 20, the independent October 19 Brink Sales Summary for
RDS-07462-Billings confirmed the net sales, tax, $3,019.82 tender total,
$3,148.22 source gross sales, every discount/meal row and both promotion rows.
All seven destination sales amounts and transaction counts also reconcile.
The independent October 19 Hourly Sales report matches all hourly net amounts
from the API and the existing Hub imports, including the $2,784.48 daily total.
The report's $24.85 void line equals the sum of this day's voided entry prices;
this observation does not redefine removed item prices as financial loss.

The comparison identified a count-only discrepancy: 199 nonempty closed records
included four zero-value records with all entries voided or deleted. Release
2026-10-20.3 excludes those records from `closed_orders`, yielding the report's
195 transactions. Fully discounted meals still count. Nonzero financial records
still count even if their item rows are removed. Source records, financial sums,
hourly allocation and void history are preserved; `excluded_removed_orders`
explains the count difference. Old saved summaries acquire the correction on
their next successful sync.

The October 6-19 Sales by Day report also matches the existing Hub hourly
imports on all 14 daily net totals: $46,646.47, with zero difference each day.
This is a comparison of existing Hub sales, not a 14-day API-detail backfill.
Only October 19's API snapshot has been independently reconciled in detail.
The evidence is in the parent workspace's
`output/PAR-Reconciliation-2026-10-20/` directory.

## Validation and rollback

`npm run test:brink` covers parsing, privacy, caching, shared cooldown, failed
requests, repeat-safe writes, classification, refunds/open adjustments, duplicate
item allocations, independent removal flags, legacy coverage and CSV escaping.
Security tests cover GM-only report exports.
`npm run test:sales` verifies the independent October 19 totals, cooking windows,
refunds, zero/missing dates, business-date overnight boundaries, and a read-only
roast refresh that retains prior data and crew entries when the network fails.

To pause reads, use **Pause automatic sync**. To revert the connection, restore
the saved sandbox host/environment/location values on the Hub project and
redeploy; existing snapshots remain separate. A Vercel code rollback alone
does not establish which environment values are active—check the Hub's connection
label and API call endpoint. Never delete sales or email to perform a rollback.
