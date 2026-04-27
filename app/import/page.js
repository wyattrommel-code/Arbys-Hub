"use client";

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const DEFAULT_HOURLY_WAGE = 10;
const DEFAULT_STORE_ID = "payson";

function toDateStr(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "";
  const y = dateValue.getFullYear();
  const m = String(dateValue.getMonth() + 1).padStart(2, "0");
  const d = String(dateValue.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateValue, days) {
  const next = new Date(dateValue);
  next.setDate(next.getDate() + days);
  return next;
}

function parseMoneyLike(value) {
  if (value == null) return 0;
  const num = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseSalesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let csvDate = null;
  for (let i = 0; i < Math.min(6, lines.length); i += 1) {
    const dateMatch = lines[i].match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i
    );
    if (dateMatch) {
      const parsedDate = new Date(dateMatch[0]);
      if (!Number.isNaN(parsedDate.getTime())) {
        csvDate = parsedDate;
      }
      break;
    }
  }

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const lineLower = lines[i].toLowerCase();
    if (lineLower.includes("hour") && lineLower.includes("net sales")) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return { error: "Could not find Hour / Net Sales columns in this CSV." };
  }

  const hourData = {};
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const hourLabel = (cols[0] || "").trim();
    if (!hourLabel) continue;
    const stopWord = hourLabel.toLowerCase();
    if (stopWord === "summary" || stopWord === "page") break;
    const hm = hourLabel.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!hm) continue;
    let hour = Number(hm[1]);
    const meridiem = hm[3].toUpperCase();
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    hourData[`h${hour}`] = parseMoneyLike(cols[1]);
  }

  if (!csvDate || Number.isNaN(csvDate.getTime())) {
    return { error: "Could not read a valid date from this CSV." };
  }

  return { date: csvDate, hourData };
}

function sumHourlyOpenTo2pm(hourData) {
  let total = 0;
  for (let h = 6; h <= 13; h += 1) {
    total += Number(hourData[`h${h}`] || 0);
  }
  return Math.round(total);
}

function sumHourly2pmToClose(hourData) {
  let total = 0;
  for (let h = 14; h <= 23; h += 1) {
    total += Number(hourData[`h${h}`] || 0);
  }
  return Math.round(total);
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function toEmployeeKey(firstName, lastName) {
  return `${String(firstName || "").trim().toLowerCase()}::${String(lastName || "").trim().toLowerCase()}`;
}

function parseLaborDate(rawValue) {
  if (!rawValue) return null;
  const parsed = new Date(String(rawValue).trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseLaborCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { rows: [], error: "CSV file is empty." };
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const required = [
    "Punch ID",
    "First Name",
    "Last Name",
    "Employee ID Code",
    "Clock In",
    "Clock Out",
    "Total Hours",
    "Total Unpaid Breaks",
  ];
  const headerMap = new Map();
  headers.forEach((name, idx) => headerMap.set(name, idx));
  const missing = required.filter((name) => !headerMap.has(name));
  if (missing.length) {
    return { rows: [], error: `Missing required columns: ${missing.join(", ")}` };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.some((c) => String(c || "").trim() !== "")) continue;
    rows.push({
      punchId: cols[headerMap.get("Punch ID")] || "",
      firstName: cols[headerMap.get("First Name")] || "",
      lastName: cols[headerMap.get("Last Name")] || "",
      employeeIdCode: cols[headerMap.get("Employee ID Code")] || "",
      clockIn: cols[headerMap.get("Clock In")] || "",
      clockOut: cols[headerMap.get("Clock Out")] || "",
      totalHoursRaw: cols[headerMap.get("Total Hours")] || "",
      unpaidBreaksRaw: cols[headerMap.get("Total Unpaid Breaks")] || "",
      rowNumber: i + 1,
    });
  }

  return { rows, error: null };
}

export default function ImportPage() {
  const [salesState, setSalesState] = useState({ loading: false, message: "", error: "" });
  const [laborState, setLaborState] = useState({
    loading: false,
    error: "",
    summary: null,
  });

  const moneyFmt = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }),
    []
  );

  async function handleSalesUpload(file) {
    if (!file) return;
    setSalesState({ loading: true, message: "", error: "" });
    try {
      const csvText = await readAsText(file);
      const parsed = parseSalesCsv(csvText);
      if (parsed.error) {
        setSalesState({ loading: false, message: "", error: parsed.error });
        return;
      }

      const supabase = getSupabase();
      const saleDateStr = toDateStr(parsed.date);
      const targetDate = addDays(parsed.date, 7);
      const targetDateStr = toDateStr(targetDate);
      const hourRows = Object.keys(parsed.hourData)
        .filter((k) => /^h\d+$/.test(k))
        .map((k) => ({
          sale_date: saleDateStr,
          hour_of_day: Number(k.slice(1)),
          net_sales: Number(parsed.hourData[k]) || 0,
        }));

      if (hourRows.length) {
        const { error: hourlyError } = await supabase
          .from("hourly_sales")
          .upsert(hourRows, { onConflict: "sale_date,hour_of_day" });
        if (hourlyError) throw hourlyError;
      }

      const amSales = sumHourlyOpenTo2pm(parsed.hourData);
      const pmSales = sumHourly2pmToClose(parsed.hourData);
      const { error: dailyTotalsError } = await supabase.from("roast_entries").upsert(
        {
          sheet_date: saleDateStr,
          daypart: "daily_totals",
          on_hand: String(amSales),
          put_in: pmSales,
          forecasted_sales: 0,
        },
        { onConflict: "sheet_date,daypart" }
      );
      if (dailyTotalsError) throw dailyTotalsError;

      const partDefs = [
        { key: "6am", start: 6, end: 14 },
        { key: "10am", start: 10, end: 18 },
        { key: "2pm", start: 14, end: 22 },
        { key: "5pm", start: 17, end: 24, nextEnd: 1 },
      ];
      const forecastRows = partDefs.map((part) => {
        let total = 0;
        for (let h = part.start; h < Math.min(part.end, 24); h += 1) {
          total += Number(parsed.hourData[`h${h}`] || 0);
        }
        if (part.nextEnd) {
          for (let h = 0; h < part.nextEnd; h += 1) {
            total += Number(parsed.hourData[`h${h}`] || 0);
          }
        }
        return {
          sheet_date: targetDateStr,
          daypart: part.key,
          forecasted_sales: Math.round(total),
        };
      });

      const { error: forecastError } = await supabase
        .from("roast_entries")
        .upsert(forecastRows, { onConflict: "sheet_date,daypart" });
      if (forecastError) throw forecastError;

      setSalesState({
        loading: false,
        error: "",
        message: `Imported hourly sales for ${saleDateStr}. Forecasts staged for ${targetDateStr}.`,
      });
    } catch (error) {
      setSalesState({
        loading: false,
        message: "",
        error: error?.message || "Sales import failed.",
      });
    }
  }

  async function handleLaborUpload(file) {
    if (!file) return;
    setLaborState({ loading: true, error: "", summary: null });
    try {
      const csvText = await readAsText(file);
      const parsed = parseLaborCsv(csvText);
      if (parsed.error) {
        setLaborState({ loading: false, error: parsed.error, summary: null });
        return;
      }

      const supabase = getSupabase();
      const { data: wageRows, error: wageError } = await supabase.from("employee_wages").select("*");
      if (wageError) throw wageError;

      const wagesByName = new Map();
      for (const row of wageRows || []) {
        const key = toEmployeeKey(row.first_name, row.last_name);
        const wage = Number(row.hourly_rate ?? row.hourly_wage ?? row.wage);
        if (key && Number.isFinite(wage)) wagesByName.set(key, wage);
      }

      const currentlyClockedIn = [];
      const over16Errors = [];
      const zeroOrBlank = [];
      const missingNames = [];
      const invalidRows = [];
      const missingWages = new Map();
      const upsertRows = [];
      let totalCostImported = 0;
      const importedDates = [];

      for (const row of parsed.rows) {
        const firstName = String(row.firstName || "").trim();
        const lastName = String(row.lastName || "").trim();
        const punchId = String(row.punchId || "").trim();
        const clockOutValue = String(row.clockOut || "").trim();
        const totalHoursRaw = String(row.totalHoursRaw || "").trim();
        const totalHours = parseMoneyLike(totalHoursRaw);
        const unpaidBreaks = parseMoneyLike(row.unpaidBreaksRaw);

        if (!firstName || !lastName) {
          missingNames.push({ rowNumber: row.rowNumber, punchId, firstName, lastName });
          continue;
        }
        if (clockOutValue.toLowerCase() === "currently clocked in") {
          currentlyClockedIn.push({ rowNumber: row.rowNumber, punchId, employeeName: `${firstName} ${lastName}` });
          continue;
        }
        if (!totalHoursRaw || totalHours <= 0) {
          zeroOrBlank.push({ rowNumber: row.rowNumber, punchId, employeeName: `${firstName} ${lastName}` });
          continue;
        }
        if (totalHours > 16) {
          over16Errors.push({
            rowNumber: row.rowNumber,
            punchId,
            employeeName: `${firstName} ${lastName}`,
            totalHours,
          });
          continue;
        }
        const clockInDate = parseLaborDate(row.clockIn);
        const clockOutDate = parseLaborDate(row.clockOut);
        if (!clockInDate || !clockOutDate || !punchId) {
          invalidRows.push({
            rowNumber: row.rowNumber,
            punchId,
            employeeName: `${firstName} ${lastName}`,
          });
          continue;
        }

        const paidHours = Math.max(0, totalHours - unpaidBreaks);
        const employeeKey = toEmployeeKey(firstName, lastName);
        const foundWage = wagesByName.get(employeeKey);
        const hourlyWage = Number.isFinite(foundWage) ? foundWage : DEFAULT_HOURLY_WAGE;
        if (!Number.isFinite(foundWage)) {
          missingWages.set(employeeKey, {
            employeeName: `${firstName} ${lastName}`,
            defaultWage: DEFAULT_HOURLY_WAGE,
          });
        }

        const shiftCost = paidHours * hourlyWage;
        totalCostImported += shiftCost;
        const logDate = toDateStr(clockInDate);
        importedDates.push(logDate);

        upsertRows.push({
          punch_id: punchId,
          log_date: logDate,
          employee_name: `${firstName} ${lastName}`,
          clock_in: clockInDate.toISOString(),
          clock_out: clockOutDate.toISOString(),
          total_hours: paidHours,
          hourly_wage: hourlyWage,
          shift_cost: shiftCost,
          store_id: DEFAULT_STORE_ID,
        });
      }

      if (upsertRows.length > 0) {
        const { error: upsertError } = await supabase
          .from("labor_logs")
          .upsert(upsertRows, { onConflict: "punch_id" });
        if (upsertError) throw upsertError;
      }

      const sortedDates = [...new Set(importedDates)].sort();
      const summary = {
        importedCount: upsertRows.length,
        skippedCurrentlyClockedInCount: currentlyClockedIn.length,
        flaggedOver16Count: over16Errors.length,
        flaggedOver16: over16Errors,
        missingWageCount: missingWages.size,
        missingWages: [...missingWages.values()],
        skippedZeroOrBlankCount: zeroOrBlank.length,
        skippedMissingNamesCount: missingNames.length,
        skippedInvalidCount: invalidRows.length,
        totalLaborCostImported: totalCostImported,
        dateRange:
          sortedDates.length > 0
            ? {
                start: sortedDates[0],
                end: sortedDates[sortedDates.length - 1],
              }
            : null,
      };

      setLaborState({ loading: false, error: "", summary });
    } catch (error) {
      setLaborState({
        loading: false,
        summary: null,
        error: error?.message || "Labor import failed.",
      });
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">CSV Imports</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Import labor from Brink time clock and sales from hourly CSV exports.
        </p>
      </div>

      <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-base font-semibold text-[#C8102E]">Import Labor (Brink time clock CSV)</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Required columns: Punch ID, First Name, Last Name, Employee ID Code, Clock In, Clock Out, Total Hours, Total
          Unpaid Breaks.
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a50d26]">
          {laborState.loading ? "Importing..." : "Import Labor"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={laborState.loading}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              await handleLaborUpload(file);
              event.target.value = "";
            }}
          />
        </label>
        {laborState.error ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{laborState.error}</p>
        ) : null}
        {laborState.summary ? (
          <div className="mt-4 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
            <p>{laborState.summary.importedCount} shifts imported successfully</p>
            <p>{laborState.summary.skippedCurrentlyClockedInCount} shifts skipped (currently clocked in)</p>
            <p>{laborState.summary.flaggedOver16Count} shifts flagged as errors (over 16 hours)</p>
            <p>{laborState.summary.missingWageCount} employees with missing wage (defaulted to $10.00)</p>
            <p>Total labor cost imported: {moneyFmt.format(laborState.summary.totalLaborCostImported)}</p>
            <p>
              Date range:{" "}
              {laborState.summary.dateRange
                ? `${laborState.summary.dateRange.start} to ${laborState.summary.dateRange.end}`
                : "No rows imported"}
            </p>

            {laborState.summary.flaggedOver16.length > 0 ? (
              <div className="mt-3">
                <p className="font-semibold text-red-700 dark:text-red-300">Flagged errors (over 16 hours)</p>
                <ul className="mt-1 list-inside list-disc text-xs text-zinc-700 dark:text-zinc-300">
                  {laborState.summary.flaggedOver16.map((item) => (
                    <li key={`${item.rowNumber}-${item.punchId}`}>
                      Row {item.rowNumber}: {item.employeeName} ({item.totalHours}h)
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {laborState.summary.missingWages.length > 0 ? (
              <div className="mt-3">
                <p className="font-semibold text-amber-700 dark:text-amber-300">Employees missing wage</p>
                <ul className="mt-1 list-inside list-disc text-xs text-zinc-700 dark:text-zinc-300">
                  {laborState.summary.missingWages.map((item) => (
                    <li key={item.employeeName}>
                      {item.employeeName} (used {moneyFmt.format(item.defaultWage)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-base font-semibold text-[#C8102E]">Import Sales (hourly sales CSV)</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Imports hourly sales, updates same-day totals, and stages next-week daypart forecasts.
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a50d26]">
          {salesState.loading ? "Importing..." : "Import Sales"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={salesState.loading}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              await handleSalesUpload(file);
              event.target.value = "";
            }}
          />
        </label>
        {salesState.error ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{salesState.error}</p>
        ) : null}
        {salesState.message ? (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{salesState.message}</p>
        ) : null}
      </article>
    </section>
  );
}
