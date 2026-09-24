#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  buildCogsReport,
  deduplicateParsedInvoices,
  parseMcLaneInvoiceText,
} from "../lib/cogs-parser.js";

const execFileAsync = promisify(execFile);

function usage(stream = process.stderr) {
  stream.write(`Usage: npm run cogs:import -- [--dry-run | --write] <PDF-or-directory> [...paths]\n`);
  stream.write(`       npm run cogs:import -- --fixture-text FILE --fixture-bytes FILE --fixture-filename NAME\n\n`);
  stream.write("Defaults to --dry-run. --write requires server-only Supabase credentials and refuses the whole batch if any PDF is rejected.\n");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, inputs: [] };
  const valueOptions = ["--fixture-text", "--fixture-bytes", "--fixture-filename"];
  const values = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (valueOptions.includes(argv[i])) {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) throw new Error(`${argv[i]} requires a value`);
      values[argv[i]] = argv[++i];
    } else positional.push(argv[i]);
  }
  const unknown = positional.filter((arg) => arg.startsWith("-") && !["--dry-run", "--write", "--replace-parser-version"].includes(arg));
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);
  if (argv.includes("--dry-run") && argv.includes("--write")) {
    throw new Error("Choose either --dry-run or --write, not both");
  }
  return {
    help: false,
    write: argv.includes("--write"),
    replaceParserVersion: argv.includes("--replace-parser-version"),
    fixture: values["--fixture-text"] ? { text: values["--fixture-text"], bytes: values["--fixture-bytes"], filename: values["--fixture-filename"] } : null,
    inputs: positional.filter((arg) => !["--dry-run", "--write", "--replace-parser-version"].includes(arg)),
  };
}

async function collect(paths) {
  const files = [];
  for (const input of paths) {
    const absolute = resolve(input);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      for (const name of await readdir(absolute)) {
        if (/\.pdf$/i.test(name)) files.push(join(absolute, name));
      }
    } else if (/\.pdf$/i.test(absolute)) {
      files.push(absolute);
    } else {
      throw new Error(`Input is not a PDF or directory: ${input}`);
    }
  }
  return [...new Set(files)].sort();
}

async function parsePdf(file, temp) {
  const bytes = await readFile(file);
  const output = join(temp, `${basename(file)}.txt`);
  await execFileAsync("pdftotext", ["-layout", file, output], {
    timeout: 30_000,
    maxBuffer: 2_000_000,
  });
  return parseMcLaneInvoiceText({
    text: await readFile(output, "utf8"),
    filename: file,
    bytes,
  });
}

function summarize(mode, accepted, rejected, writes = []) {
  const foodTotal = accepted.reduce((sum, parsed) => sum + parsed.invoice.food_total, 0);
  const nonFoodTotal = accepted.reduce((sum, parsed) => sum + parsed.invoice.non_food_total, 0);
  const categoryTotals = {};
  for (const parsed of accepted) {
    for (const line of parsed.lines) {
      categoryTotals[line.category] = (categoryTotals[line.category] ?? 0) + line.extended_amount;
    }
  }
  for (const key of Object.keys(categoryTotals)) categoryTotals[key] = Number(categoryTotals[key].toFixed(2));
  return {
    mode,
    parser_version: accepted[0]?.invoice.parser_version ?? null,
    invoice_count: accepted.length,
    line_count: accepted.reduce((sum, parsed) => sum + parsed.lines.length, 0),
    catch_weight_line_count: accepted.reduce((sum, parsed) => sum + parsed.lines.filter((line) => line.price_basis === "catch_weight").length, 0),
    food_total: Number(foodTotal.toFixed(2)),
    non_food_total: Number(nonFoodTotal.toFixed(2)),
    category_totals: Object.fromEntries(Object.entries(categoryTotals).sort(([a], [b]) => a.localeCompare(b))),
    delivery_dates: [...new Set(accepted.map((parsed) => parsed.invoice.delivery_date))].sort(),
    ...buildCogsReport(accepted),
    sources: accepted.map((parsed) => ({
      invoice_number: parsed.invoice.invoice_number,
      delivery_date: parsed.invoice.delivery_date,
      sha256: parsed.invoice.source_sha256,
      lines: parsed.lines.length,
      food_total: parsed.invoice.food_total,
      non_food_total: parsed.invoice.non_food_total,
    })),
    writes,
    rejected,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage(process.stdout);
    return;
  }
  if (!options.inputs.length && !options.fixture) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (options.fixture && (!options.fixture.bytes || !options.fixture.filename || options.inputs.length)) {
    throw new Error("Fixture mode requires text, bytes, and filename and cannot be mixed with PDFs");
  }
  const files = options.fixture ? [] : await collect(options.inputs);
  if (!files.length && !options.fixture) throw new Error("No PDF files found in the supplied inputs");
  const temp = await mkdtemp(join(tmpdir(), "mclane-cogs-"));
  let parsed = [];
  const rejected = [];
  try {
    if (options.fixture) {
      parsed.push(parseMcLaneInvoiceText({
        text: await readFile(resolve(options.fixture.text), "utf8"),
        bytes: await readFile(resolve(options.fixture.bytes)),
        filename: options.fixture.filename,
      }));
    }
    for (const file of files) {
      try {
        parsed.push(await parsePdf(file, temp));
      } catch (error) {
        rejected.push({ file: basename(file), error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  const deduplicated = deduplicateParsedInvoices(parsed);
  parsed = deduplicated.accepted;
  rejected.push(...deduplicated.rejected);
  const writes = [];

  // Fail closed: parsing/validation of every document completes before the first database call.
  if (options.write) {
    if (rejected.length) {
      console.log(JSON.stringify(summarize("write-refused", parsed, rejected), null, 2));
      process.exitCode = 1;
      return;
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("--write requires NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY");
    }
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // Classify exact existing replays before the atomic write so a failed batch
    // audit does not mislabel rows that were already committed in an earlier run.
    const invoiceNumbers = parsed.map((item) => item.invoice.invoice_number);
    const { data: existingRows, error: preflightError } = await db
      .from("cogs_invoices")
      .select("invoice_number,source_sha256,parser_version")
      .in("invoice_number", invoiceNumbers);
    if (preflightError) {
      console.log(JSON.stringify({
        ...summarize("write-preflight-failed", parsed, rejected),
        audit: { committed: [], replayed: [], pending: [], database_state: "unknown; no write attempted" },
        write_error: preflightError.message,
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    const existingByInvoice = new Map((existingRows ?? []).map((row) => [String(row.invoice_number), row]));
    const knownReplays = [];
    const batch = [];
    for (const item of parsed) {
      const invoice = item.invoice;
      const existing = existingByInvoice.get(String(invoice.invoice_number));
      if (existing
          && existing.source_sha256 === invoice.source_sha256
          && existing.parser_version === invoice.parser_version) {
        knownReplays.push({ invoice_number: invoice.invoice_number, sha256: invoice.source_sha256, status: "replayed" });
      } else {
        batch.push(item);
      }
    }

    let data = { results: [] };
    let error = null;
    if (batch.length) {
      ({ data, error } = await db.rpc("cogs_import_batch", {
        p_batch: batch,
        p_allow_parser_replace: options.replaceParserVersion,
      }));
    }
    if (error) {
      const pending = batch.map((item) => ({ invoice_number: item.invoice.invoice_number, sha256: item.invoice.source_sha256 }));
      console.log(JSON.stringify({
        ...summarize("write-failed-rolled-back", parsed, rejected),
        audit: { committed: [], replayed: knownReplays.map(({ invoice_number, sha256 }) => ({ invoice_number, sha256 })), pending },
        write_error: error.message,
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    writes.push(...knownReplays, ...(data?.results ?? []));
  }

  const summary = summarize(options.write ? "write" : "dry-run", parsed, rejected, writes);
  if (options.write) summary.audit = {
    committed: writes.filter((row) => row.status !== "replayed").map(({ invoice_number, sha256 }) => ({ invoice_number, sha256 })),
    replayed: writes.filter((row) => row.status === "replayed").map(({ invoice_number, sha256 }) => ({ invoice_number, sha256 })),
    pending: [],
  };
  console.log(JSON.stringify(summary, null, 2));
  if (rejected.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`McLane COGS import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
