import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixture = new URL("./fixtures/mclane-invoice.txt", import.meta.url);
const script = new URL("../scripts/import-mclane-cogs.mjs", import.meta.url);

const scriptSource = await import("node:fs/promises").then(({ readFile }) => readFile(script, "utf8"));

test("CLI fixture mode exercises parser and summary without pdftotext", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    script.pathname,
    "--dry-run",
    "--fixture-text", fixture.pathname,
    "--fixture-bytes", fixture.pathname,
    "--fixture-filename", "292855_0007462_12345678.PDF",
  ], { cwd: new URL("..", import.meta.url).pathname });
  const report = JSON.parse(stdout);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.invoice_count, 1);
  assert.equal(report.line_count, 4);
  assert.equal(report.food_total, 50);
  assert.equal(report.non_food_total, 3);
  assert.match(report.sources[0].sha256, /^[a-f0-9]{64}$/);
});

test("write path preflights existing exact replays before the atomic batch", () => {
  const preflight = scriptSource.indexOf('.from("cogs_invoices")');
  const write = scriptSource.indexOf('db.rpc("cogs_import_batch"');
  assert.ok(preflight >= 0 && write > preflight);
  assert.match(scriptSource, /replayed: knownReplays\.map/);
  assert.match(scriptSource, /const pending = batch\.map/);
  assert.doesNotMatch(scriptSource, /pending = parsed\.map/);
});
