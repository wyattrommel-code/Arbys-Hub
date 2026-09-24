# McLane COGS purchase proxy

This feature imports authoritative McLane PDFs for customer `292855`, unit `0007462`. It reports FOOD purchases by delivery window. It is a purchase proxy, **not** actual or theoretical COGS: inventory movement, recipes, portions, and yields are not inferred.

## Safe dry run

```sh
npm run cogs:report -- /path/to/exported-pdfs
```

The JSON audit includes every source SHA-256, invoice/line counts, FOOD and non-food totals, catch-weight row count, rejects, top FOOD SKUs, and price changes. Source PDFs and service-role credentials must never be committed.

Deterministic parser/CLI testing does not require `pdftotext`:

```sh
node scripts/import-mclane-cogs.mjs --dry-run \
  --fixture-text tests/fixtures/mclane-invoice.txt \
  --fixture-bytes tests/fixtures/mclane-invoice.txt \
  --fixture-filename 292855_0007462_12345678.PDF
```

## Writes and replay policy

`--write` requires server-only `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The importer validates all documents first and sends one `cogs_import_batch` RPC. PostgreSQL commits the complete batch or rolls it all back. Failure output lists all hashes as pending and none as committed.

A same-SHA, same-parser replay is a no-op. A same invoice number with a different SHA is rejected. Reprocessing the authoritative same SHA with a newer parser requires the deliberate `--replace-parser-version` flag; lines and derived records are replaced atomically.

## Price basis and item mappings

Catch-weight invoice rows persist `price_basis='catch_weight'`, `price_uom='LB'`, and `catch_weight`; their observed price is per pound, never per case. Cost history is keyed by SKU, shipped UOM, price basis, and actual price UOM.

Inventory and waste pages use only verified rows in `cogs_item_mappings`. The migration seeds no mappings. Each mapping records target item/type, supplier SKU/UOM, price basis/UOM, target UOM, mapping version, verification source/person/time, and an optional cost multiplier. A multiplier is mandatory whenever source and target bases are not directly identical, including every catch-weight mapping. Descriptions are never fuzzy matched and package yields are never invented.

Run all parser, dashboard, mapping, and PGlite database integration tests with:

```sh
npm run test:cogs
```
