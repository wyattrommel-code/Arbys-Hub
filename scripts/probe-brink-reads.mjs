import { mkdir, open, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityBatches, probeCapability } from "../lib/brink-capabilities.js";
import { brinkConfig, validBusinessDate } from "../lib/brink.js";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (!Object.hasOwn(capabilityBatches, input.batch) || !validBusinessDate(input.businessDate)) {
  throw new Error("Select core/reference and a valid business date.");
}
if (input.host !== "api6.brinkpos.net" || input.locationName !== "ARBY'S RDS-07462-Billings") {
  throw new Error("Unexpected production location.");
}
const config = brinkConfig({
  BRINK_ENVIRONMENT: "production", BRINK_API_HOST: input.host,
  BRINK_ACCESS_TOKEN: input.accessToken, BRINK_LOCATION_TOKEN: input.locationToken,
});
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const folder = join(root, "output", "PAR-Production-Capabilities-2026-10-20");
await mkdir(folder, { recursive: true });
const lockPath = join(folder, "probe.lock");
const lock = await open(lockPath, "wx");
try {
  const last = await readFile(join(folder, "last-attempt.json"), "utf8").then(JSON.parse).catch(() => null);
  if (last && Date.now() - Date.parse(last.started_at) < 180000) {
    throw new Error("Wait at least three minutes between capability batches.");
  }
  const target = join(folder, `${input.batch}.json`);
  if (await readFile(target, "utf8").then(() => true).catch(() => false)) {
    throw new Error("This batch already has evidence. Review it before making more requests.");
  }
  const summary = {
    batch: input.batch, location: input.locationName, host: input.host, business_date: input.businessDate,
    started_at: new Date().toISOString(), status: "started",
    raw_records_saved: false, hub_configuration_changed: false, database_writes: false,
    methods: capabilityBatches[input.batch].map(operation => ({ operation, status: "started" })),
  };
  await writeFile(join(folder, "last-attempt.json"), JSON.stringify({ started_at: summary.started_at }));
  await writeFile(target, JSON.stringify(summary, null, 2));
  // PAR guidance allows up to five concurrent calls; batches wait three minutes.
  const outcomes = await Promise.allSettled(capabilityBatches[input.batch].map(operation =>
    probeCapability({ operation, businessDate: input.businessDate, config })));
  summary.methods = outcomes.map((r, i) => r.status === "fulfilled" ? r.value :
    { operation: capabilityBatches[input.batch][i], status: "local_error" });
  summary.status = "completed";
  summary.finished_at = new Date().toISOString();
  await writeFile(target, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, evidence_path: target }));
} finally {
  input = undefined;
  config.accessToken = undefined;
  config.locationToken = undefined;
  await lock.close();
  await unlink(lockPath);
}
