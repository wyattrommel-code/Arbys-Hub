# Kitchen timing and deployment history

Managers save the full current station coverage in **Deployment**, then save another version when someone moves or leaves. Blank effective time means the moment of saving; an explicit time uses America/Denver. Backdated saves must be later than the most recent version. Clearing every station ends coverage. The signed-in manager is the recorded submitter. Competing edits require a reload.

**Reports → Kitchen Timing & Deployments** shows order and item send-to-bump timing, unique orders, queue/send events, average, median, P90 and half-hour volume. Managers enable kitchen collection on that page. It runs after successful automatic sales syncs, within the same deadline and shared two-minute connection cooldown. Yesterday gets its own retryable daily reconciliation. Reading reports uses saved data and makes no PAR calls.

Confirmed by the store manager on October 20, 2026:

| Brink queue | Hub station coverage |
| --- | --- |
| DT / Drive Thru | DT Cashier + DT Order Taker |
| DT Expo | Runner |
| Expo | Runner |
| Fry / Fryer | Fryer |
| Slicer | Backline + Slicer |

Market Fresh and combined queues remain unconfirmed. Queue names are cached from GetKitchenQueues; if configuration changes, an integrator must refresh that cache and reconfirm mappings before interpreting new queues.

## Interpretation

Timing is SendTime → BumpTime, including waiting and preparation. It is not a vehicle loop, window, or employee labor measurement. Queue timers can overlap, so do not add their averages to calculate total DT time. An order can visit several queues and have multiple sends. Order events and item events are reported separately.

Only identical records are deduplicated. Conflicting records for the same order/queue/send (and item ID for item events), missing timestamps, and negative durations are excluded from speed statistics. Long durations remain included and are flagged above 30 minutes. Empty successful data is distinct from a failed request.

Employee attribution requires every mapped role to be covered, with the same staff and role assignment throughout the entire event. Shared coverage is shown as a group. Partial coverage, handoffs and no-deployment intervals are separate categories. Versions expire at the next version or local midnight; overnight events are conservatively left unmatched. Legacy shift summaries do not reconstruct an accurate timeline. No receipt cashier ID is used as the kitchen worker identity. Timing alone does not establish individual performance or the cause of delays.

## Storage and failure behavior

- `brink_kitchen_days`: one replaceable sanitized snapshot per connection/business date, containing order/item IDs, queue IDs, send numbers and timestamps. No payment/customer payloads or raw XML archives.
- `brink_kitchen_state`: per-connection opt-in, cached queues, latest error/success and reconciliation date.
- `deployment_versions`: immutable timestamped snapshots with stable roster employee IDs, display names, stations and notes. `hub_save_deployment` appends a version and updates the legacy shift summary in one transaction. Request UUIDs make retries idempotent; the previous version ID prevents stale overwrites.
- Both kitchen methods must succeed before a day is replaced. HTTP 200 alone is insufficient: SOAP shape and PAR ResultCode 0 are required. Intent is logged before each outbound call. Errors retain redacted messages, result codes and hashes in existing PAR call logs.
- Kitchen failures preserve earlier kitchen data and do not fail or overwrite successful sales. No automatic immediate PAR retry; the next scheduled cycle retries. Two kitchen reads run concurrently, below PAR's five-call limit.
- New tables have RLS, revoked anonymous/authenticated grants and explicit service-role access. Dedicated endpoints recheck the current employee role. The generic data proxy cannot write deployment summaries or access new tables; clock-only deployment routes remain blocked.

Apply `20261020215516_kitchen_deployment_timing.sql` before deploying the application. Initially collection is off. After publishing, enable it and verify a saved day plus successful automatic calls. Do not create fictitious deployment assignments to test production.

Validation: `npm run test:brink`, `npm run test:security`, `npm run test:security:http`, `npm run lint`, `npm run build`. Database tests cover rollback, immutable history, idempotency, stale writes and table/function privileges. Synthetic HTTP tests cover authentication/authorization.

PAR contracts: [order bumps](https://developers.partech.com/docs/parpos-cloud-apis/soap/kitchen/post/GetOrderBumpTimes), [item bumps](https://developers.partech.com/docs/parpos-cloud-apis/soap/kitchen/post/GetOrderItemBumpTimes), [API usage guidance](https://developers.partech.com/docs/parpos-cloud-apis/soap/bestpracticeandfaqs).
