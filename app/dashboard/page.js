"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getSupabase } from "@/lib/supabase";

const ARBY_RED = "#C8102E";
const GREEN = "#2a7a3b";
const YELLOW = "#E8A020";
const RED = "#C8102E";

const REPORT_TYPES = [
  "Daily Summary",
  "Sales Detail",
  "Labor Detail",
  "Waste Log",
  "Inventory Counts",
  "Roast Beef Log",
];

function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayLocalISODate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtMoney(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtMoney2(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "0.0%";
  return `${n.toFixed(1)}%`;
}

function fmtSignedPct(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mmssFromSec(totalSec) {
  const sec = Math.max(0, Math.round(toNum(totalSec)));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function colorByLaborPct(pct) {
  if (pct < 20) return GREEN;
  if (pct <= 25) return YELLOW;
  return RED;
}

function colorByWasteDollar(v) {
  if (v < 200) return GREEN;
  if (v <= 350) return YELLOW;
  return RED;
}

function colorByWastePct(pct) {
  if (pct < 5) return GREEN;
  if (pct <= 8) return YELLOW;
  return RED;
}

function colorByDtSec(sec) {
  if (sec < 270) return GREEN;
  if (sec <= 360) return YELLOW;
  return RED;
}

function getSalesValue(row) {
  return toNum(row?.net_sales ?? row?.sales ?? row?.total_sales ?? row?.amount);
}

function getLaborHours(row) {
  return toNum(row?.hours ?? row?.total_hours ?? row?.regular_hours);
}

function getLaborCost(row) {
  return toNum(row?.labor_cost ?? row?.shift_cost ?? row?.cost);
}

function getWasteRetail(row) {
  return toNum(row?.total_retail_loss);
}

function getWasteWholesale(row) {
  return toNum(row?.total_wholesale_cost);
}

function formatHourLabel(h) {
  const suffix = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}

function getPctDiff(current, prior) {
  if (!Number.isFinite(prior) || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function EmptyState({ title }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-semibold text-zinc-800 dark:text-zinc-200">{title} data not yet connected</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Data will appear here once connected</p>
    </div>
  );
}

function SalesImportEmptyState() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-semibold text-zinc-800 dark:text-zinc-200">
        No sales data for this date - upload a sales CSV on the Import page to populate sales data
      </p>
      <Link href="/import" className="mt-2 inline-block text-xs font-semibold text-[#C8102E] underline">
        Go to Import
      </Link>
    </div>
  );
}

function DtEmptyState() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-semibold text-zinc-800 dark:text-zinc-200">No DT data for this date</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">DT data syncs automatically each night via HME</p>
    </div>
  );
}

function MetricCard({ title, value, sub, color = "text-zinc-900", subColor = "text-zinc-500 dark:text-zinc-400" }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      <p className={`mt-1 text-xs ${subColor}`}>{sub}</p>
    </div>
  );
}

function Expandable({ title, summary, open, setOpen, children, empty, titleClassName = "text-zinc-900 dark:text-zinc-100" }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div>
          <p className={`text-sm font-bold ${titleClassName}`}>{title}</p>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{summary}</div>
        </div>
        <span className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open ? <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">{empty ? <EmptyState title={title} /> : children}</div> : null}
    </section>
  );
}

function getWeekBounds() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

export default function DashboardPage() {
  const [tab, setTab] = useState("DASHBOARD");
  const [selectedDate, setSelectedDate] = useState(yesterdayLocalISODate);
  const [reportStart, setReportStart] = useState(addDays(todayLocalISODate(), -7));
  const [reportEnd, setReportEnd] = useState(todayLocalISODate);
  const [reportType, setReportType] = useState("Daily Summary");
  const [expanded, setExpanded] = useState({
    labor: false,
    sales: false,
    dt: false,
    waste: false,
    roast: false,
    deployment: false,
    inventory: false,
  });

  const [state, setState] = useState({
    loading: true,
    salesRows: [],
    lastWeekSalesRows: [],
    lastWeekDtRows: [],
    laborRows: [],
    wasteRows: [],
    inventoryRows: [],
    roastRows: [],
    deploymentLogs: [],
    deploymentAssignments: [],
    dtRows: [],
    weekSalesRows: [],
    weekLaborRows: [],
    weekWasteRows: [],
    disconnected: {
      sales: false,
      labor: false,
      waste: false,
      inventory: false,
      roast: false,
      dt: false,
      deployment: false,
    },
  });
  const [reportState, setReportState] = useState({
    loading: false,
    salesRows: [],
    laborRows: [],
    wasteRows: [],
    inventoryRows: [],
    roastRows: [],
    dtRows: [],
    deploymentLogs: [],
    disconnected: {
      sales: false,
      labor: false,
      waste: false,
      inventory: false,
      roast: false,
      dt: false,
      deployment: false,
    },
  });

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setState((s) => ({ ...s, loading: true }));
      const { start: weekStart, end: weekEnd } = getWeekBounds();
      const supabase = getSupabase();

      const readDate = async (table, key, dateVal, selectColumns = "*") => {
        try {
          const { data, error } = await supabase.from(table).select(selectColumns).eq(key, dateVal);
          if (error) return { rows: [], disconnected: true };
          return { rows: data ?? [], disconnected: false };
        } catch {
          return { rows: [], disconnected: true };
        }
      };

      const readRange = async (table, key, start, end, selectColumns = "*") => {
        try {
          const { data, error } = await supabase.from(table).select(selectColumns).gte(key, start).lte(key, end);
          if (error) return { rows: [], disconnected: true };
          return { rows: data ?? [], disconnected: false };
        } catch {
          return { rows: [], disconnected: true };
        }
      };

      const [
        sales,
        lastWeekSales,
        lastWeekDt,
        labor,
        waste,
        inventory,
        roast,
        dt,
        weekSales,
        weekLabor,
        weekWaste,
        deployment,
      ] = await Promise.all([
        readDate("hourly_sales", "sale_date", selectedDate),
        readDate("hourly_sales", "sale_date", addDays(selectedDate, -7)),
        readDate("dt_logs", "log_date", addDays(selectedDate, -7)),
        readDate("labor_logs", "log_date", selectedDate),
        readDate("waste_logs", "log_date", selectedDate, "*"),
        readDate("inventory_logs", "log_date", selectedDate),
        readDate("roast_entries", "sheet_date", selectedDate),
        readDate("dt_logs", "log_date", selectedDate),
        readRange("hourly_sales", "sale_date", weekStart, weekEnd),
        readRange("labor_logs", "log_date", weekStart, weekEnd),
        readRange("waste_logs", "log_date", weekStart, weekEnd, "*"),
        readDate("deployment_logs", "log_date", selectedDate),
      ]);

      let deploymentAssignments = [];
      let deploymentDisconnected = deployment.disconnected;
      if (!deploymentDisconnected && deployment.rows.length > 0) {
        try {
          const ids = deployment.rows.map((row) => row.id).filter(Boolean);
          if (ids.length > 0) {
            const { data, error } = await supabase.from("deployment_assignments").select("*").in("deployment_id", ids);
            if (error) {
              deploymentDisconnected = true;
            } else {
              deploymentAssignments = data || [];
            }
          }
        } catch {
          deploymentDisconnected = true;
        }
      }

      if (cancelled) return;
      setState({
        loading: false,
        salesRows: sales.rows,
        lastWeekSalesRows: lastWeekSales.rows,
        lastWeekDtRows: lastWeekDt.rows,
        laborRows: labor.rows,
        wasteRows: waste.rows,
        inventoryRows: inventory.rows,
        roastRows: roast.rows,
        deploymentLogs: deployment.rows,
        deploymentAssignments,
        dtRows: dt.rows,
        weekSalesRows: weekSales.rows,
        weekLaborRows: weekLabor.rows,
        weekWasteRows: weekWaste.rows,
        disconnected: {
          sales: sales.disconnected,
          labor: labor.disconnected,
          waste: waste.disconnected,
          inventory: inventory.disconnected,
          roast: roast.disconnected,
          dt: dt.disconnected,
          deployment: deploymentDisconnected,
        },
      });
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadReports() {
      setReportState((s) => ({ ...s, loading: true }));
      const supabase = getSupabase();
      const readRange = async (table, key, selectColumns = "*") => {
        try {
          const { data, error } = await supabase.from(table).select(selectColumns).gte(key, reportStart).lte(key, reportEnd);
          if (error) return { rows: [], disconnected: true };
          return { rows: data ?? [], disconnected: false };
        } catch {
          return { rows: [], disconnected: true };
        }
      };
      const [sales, labor, waste, inventory, roast, dt, deployment] = await Promise.all([
        readRange("hourly_sales", "sale_date"),
        readRange("labor_logs", "log_date"),
        readRange("waste_logs", "log_date", "*"),
        readRange("inventory_logs", "log_date"),
        readRange("roast_entries", "sheet_date"),
        readRange("dt_logs", "log_date"),
        readRange("deployment_logs", "log_date"),
      ]);
      if (cancelled) return;
      setReportState({
        loading: false,
        salesRows: sales.rows,
        laborRows: labor.rows,
        wasteRows: waste.rows,
        inventoryRows: inventory.rows,
        roastRows: roast.rows,
        dtRows: dt.rows,
        deploymentLogs: deployment.rows,
        disconnected: {
          sales: sales.disconnected,
          labor: labor.disconnected,
          waste: waste.disconnected,
          inventory: inventory.disconnected,
          roast: roast.disconnected,
          dt: dt.disconnected,
          deployment: deployment.disconnected,
        },
      });
    }

    loadReports();
    return () => {
      cancelled = true;
    };
  }, [reportStart, reportEnd]);

  const snapshot = useMemo(() => {
    const salesTotal = state.salesRows.reduce((sum, row) => sum + getSalesValue(row), 0);
    const lastWeekSalesTotal = state.lastWeekSalesRows.reduce((sum, row) => sum + getSalesValue(row), 0);
    const laborCost = state.laborRows.reduce((sum, row) => sum + getLaborCost(row), 0);
    const laborHours = state.laborRows.reduce((sum, row) => sum + getLaborHours(row), 0);
    const wasteRetail = state.wasteRows.reduce((sum, row) => sum + getWasteRetail(row), 0);
    const wasteWholesale = state.wasteRows.reduce((sum, row) => sum + getWasteWholesale(row), 0);
    const dtHourlyMap = new Map();
    let totalCars = 0;
    let totalWeightedLaneSec = 0;
    for (const row of state.dtRows) {
      const hour = toNum(row?.hour_of_day);
      const cars = toNum(row?.total_cars);
      const laneSec = toNum(row?.lane_total_seconds);
      if (hour < 0 || hour > 23 || cars <= 0 || laneSec < 0) continue;
      totalCars += cars;
      totalWeightedLaneSec += laneSec * cars;
      if (!dtHourlyMap.has(hour)) dtHourlyMap.set(hour, { cars: 0, weightedSec: 0 });
      const bucket = dtHourlyMap.get(hour);
      bucket.cars += cars;
      bucket.weightedSec += laneSec * cars;
    }
    const dtAvgSec = totalCars > 0 ? totalWeightedLaneSec / totalCars : 0;
    const dtByHour = [...dtHourlyMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, bucket]) => {
        const avgSec = bucket.cars > 0 ? bucket.weightedSec / bucket.cars : 0;
        return {
          hour,
          label: formatHourLabel(hour),
          cars: bucket.cars,
          avgSec,
          barColor: colorByDtSec(avgSec),
        };
      });
    const peakDtHour = dtByHour.reduce((best, row) => (row.cars > best.cars ? row : best), {
      label: "--",
      cars: 0,
      avgSec: 0,
    });
    const slowestCandidates = dtByHour.filter((row) => row.cars >= 3);
    const slowestDtHour = slowestCandidates.reduce(
      (best, row) => (row.avgSec > best.avgSec ? row : best),
      { label: "--", cars: 0, avgSec: 0 }
    );

    const lastWeekCars = state.lastWeekDtRows.reduce((sum, row) => sum + toNum(row?.total_cars), 0);
    const lastWeekWeightedLaneSec = state.lastWeekDtRows.reduce(
      (sum, row) => sum + toNum(row?.lane_total_seconds) * toNum(row?.total_cars),
      0
    );
    const lastWeekDtAvgSec = lastWeekCars > 0 ? lastWeekWeightedLaneSec / lastWeekCars : 0;
    const dtDiffSec = dtAvgSec - lastWeekDtAvgSec;
    const dtDiffPct = getPctDiff(dtAvgSec, lastWeekDtAvgSec);

    const laborPct = salesTotal > 0 ? (laborCost / salesTotal) * 100 : 0;
    const wastePct = salesTotal > 0 ? (wasteRetail / salesTotal) * 100 : 0;
    const splh = laborHours > 0 ? salesTotal / laborHours : 0;

    const salesBuckets = new Map();
    for (const row of state.salesRows) {
      const hour = toNum(row?.hour_of_day);
      const val = getSalesValue(row);
      if (hour < 0 || hour > 23 || val <= 0) continue;
      salesBuckets.set(hour, (salesBuckets.get(hour) || 0) + val);
    }
    const salesByHour = [...salesBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, sales]) => ({ hour, label: formatHourLabel(hour), sales }));
    const peak = salesByHour.reduce((best, row) => (row.sales > best.sales ? row : best), {
      hour: 0,
      label: "--",
      sales: 0,
    });

    const wasteByItem = new Map();
    for (const row of state.wasteRows) {
      const name = row?.item_name ?? row?.item ?? "Unknown";
      wasteByItem.set(name, (wasteByItem.get(name) || 0) + getWasteRetail(row));
    }
    const topWaste = [...wasteByItem.entries()].sort((a, b) => b[1] - a[1])[0] || ["—", 0];

    const roastMap = new Map(state.roastRows.map((r) => [String(r.daypart || "").toLowerCase(), r]));
    const put6 = toNum(roastMap.get("6am")?.put_in);
    const put10 = toNum(roastMap.get("10am")?.put_in);
    const put2 = toNum(roastMap.get("2pm")?.put_in);
    const put5 = toNum(roastMap.get("5pm")?.put_in);
    const oh6 = toNum(roastMap.get("6am")?.on_hand);
    const oh10 = toNum(roastMap.get("10am")?.on_hand);
    const oh2 = toNum(roastMap.get("2pm")?.on_hand);
    const oh5 = toNum(roastMap.get("5pm")?.on_hand);
    const ohClose = toNum(roastMap.get("close")?.on_hand);
    const usedAm = Math.max(0, oh6 + put6 - oh10) + Math.max(0, oh10 + put10 - oh2);
    const usedPm = Math.max(0, oh2 + put2 - oh5) + Math.max(0, oh5 + put5 - ohClose);
    const totalRoastUsed = usedAm + usedPm;

    const amSales = toNum(roastMap.get("daily_totals")?.on_hand);
    const pmSales = toNum(roastMap.get("daily_totals")?.put_in);
    const amDpr = usedAm > 0 ? amSales / usedAm : 0;
    const pmDpr = usedPm > 0 ? pmSales / usedPm : 0;
    const blendedDpr = totalRoastUsed > 0 ? (amSales + pmSales) / totalRoastUsed : 0;

    const invTotal = state.inventoryRows.reduce((sum, row) => sum + toNum(row.total_value), 0);
    const invByCategory = new Map();
    for (const row of state.inventoryRows) {
      const cat = row.category || "Other";
      invByCategory.set(cat, (invByCategory.get(cat) || 0) + toNum(row.total_value));
    }
    const invCats = [...invByCategory.entries()];

    return {
      salesTotal,
      lastWeekSalesTotal,
      salesDiffDollar: salesTotal - lastWeekSalesTotal,
      salesDiffPct: getPctDiff(salesTotal, lastWeekSalesTotal),
      hasSalesData: state.salesRows.some((r) => getSalesValue(r) > 0),
      laborCost,
      laborHours,
      laborPct,
      wasteRetail,
      wasteWholesale,
      wastePct,
      totalCars,
      dtAvgSec,
      hasDtData: totalCars > 0,
      dtByHour,
      peakDtHour,
      slowestDtHour,
      lastWeekDtAvgSec,
      dtDiffSec,
      dtDiffPct,
      splh,
      salesByHour,
      peak,
      topWaste,
      roast: { put6, put10, put2, put5, ohClose, usedAm, usedPm, totalRoastUsed, amDpr, pmDpr, blendedDpr },
      inventory: { total: invTotal, categories: invCats },
    };
  }, [state]);

  const weekSummary = useMemo(() => {
    const { start } = getWeekBounds();
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return days.map((d) => {
      const sales = state.weekSalesRows.filter((r) => r.sale_date === d).reduce((sum, r) => sum + getSalesValue(r), 0);
      const laborCost = state.weekLaborRows.filter((r) => r.log_date === d).reduce((sum, r) => sum + getLaborCost(r), 0);
      const waste = state.weekWasteRows.filter((r) => r.log_date === d).reduce((sum, r) => sum + getWasteRetail(r), 0);
      const laborPct = sales > 0 ? (laborCost / sales) * 100 : 0;
      return { date: d, sales, laborPct, waste };
    });
  }, [state.weekSalesRows, state.weekLaborRows, state.weekWasteRows]);

  const weekAgg = useMemo(() => {
    const weekSales = weekSummary.reduce((s, d) => s + d.sales, 0);
    const weekWaste = weekSummary.reduce((s, d) => s + d.waste, 0);
    const validLabor = weekSummary.filter((d) => d.sales > 0);
    const laborAvg =
      validLabor.length > 0 ? validLabor.reduce((s, d) => s + d.laborPct, 0) / validLabor.length : 0;
    return { weekSales, weekWaste, laborAvg, dtAvgSec: snapshot.dtAvgSec };
  }, [weekSummary, snapshot.dtAvgSec]);

  const deploymentSnapshot = useMemo(() => {
    const logs = state.deploymentLogs || [];
    const assignments = state.deploymentAssignments || [];
    const morningLog = logs.find((log) => String(log.shift || "").toLowerCase() === "morning") || null;
    const nightLog = logs.find((log) => String(log.shift || "").toLowerCase() === "night") || null;
    const peopleFor = (log) => assignments.filter((a) => a.deployment_id === log?.id);
    return {
      morningLog,
      nightLog,
      morningAssignments: morningLog ? peopleFor(morningLog) : [],
      nightAssignments: nightLog ? peopleFor(nightLog) : [],
      hasAny: Boolean(morningLog || nightLog),
    };
  }, [state.deploymentAssignments, state.deploymentLogs]);

  const reportRows = useMemo(() => {
    const dates = Array.from(
      new Set([
        ...reportState.salesRows.map((r) => r.sale_date),
        ...reportState.laborRows.map((r) => r.log_date),
        ...reportState.wasteRows.map((r) => r.log_date),
        ...reportState.dtRows.map((r) => r.log_date),
      ])
    ).sort();

    const daily = dates.map((date) => {
      const sales = reportState.salesRows.filter((r) => r.sale_date === date).reduce((s, r) => s + getSalesValue(r), 0);
      const laborCost = reportState.laborRows.filter((r) => r.log_date === date).reduce((s, r) => s + getLaborCost(r), 0);
      const waste = reportState.wasteRows
        .filter((r) => r.log_date === date)
        .reduce((s, r) => s + toNum(r.total_retail_loss), 0);
      const dtRows = reportState.dtRows.filter((r) => r.log_date === date);
      const dtCars = dtRows.reduce((s, r) => s + toNum(r.total_cars), 0);
      const dtWeighted = dtRows.reduce((s, r) => s + toNum(r.lane_total_seconds) * toNum(r.total_cars), 0);
      const dtAvg = dtCars > 0 ? dtWeighted / dtCars : 0;
      const laborPct = sales > 0 ? (laborCost / sales) * 100 : 0;
      const dayDeployments = reportState.deploymentLogs.filter((r) => r.log_date === date);
      const morning = dayDeployments.find((d) => String(d.shift || "").toLowerCase() === "morning") || null;
      const night = dayDeployments.find((d) => String(d.shift || "").toLowerCase() === "night") || null;
      return { date, sales, laborPct, waste, dtAvg, roastsUsed: 0, morningDeployment: morning, nightDeployment: night };
    });

    const salesByDate = new Map();
    for (const row of reportState.salesRows) {
      const date = row.sale_date;
      const hour = toNum(row.hour_of_day);
      const sales = getSalesValue(row);
      if (!date || hour < 0 || hour > 23) continue;
      if (!salesByDate.has(date)) salesByDate.set(date, new Map());
      const dayMap = salesByDate.get(date);
      dayMap.set(hour, (dayMap.get(hour) || 0) + sales);
    }
    const salesDetailByDate = [...salesByDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, hourMap]) => {
        const rows = [...hourMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([hour, sales]) => ({ hour, label: formatHourLabel(hour), sales }));
        const subtotal = rows.reduce((sum, r) => sum + r.sales, 0);
        return { date, rows, subtotal };
      });

    const laborDetail = reportState.laborRows.map((r, idx) => ({
      id: `${r.log_date}-${idx}`,
      date: r.log_date,
      employee: r.employee_name ?? r.employee ?? "Employee",
      hours: getLaborHours(r),
      wage: toNum(r.wage ?? r.hourly_rate),
      cost: getLaborCost(r),
    }));

    const wasteLog = reportState.wasteRows.map((r, idx) => ({
      id: `${r.log_date}-${idx}`,
      date: r.log_date,
      shift: r.shift ?? "—",
      submittedBy: r.submitted_by ?? "—",
      item: r.item_name ?? "Unknown",
      qty: toNum(r.quantity),
      unit: r.unit ?? "ea",
      retail: toNum(r.total_retail_loss),
      wholesale: toNum(r.total_wholesale_cost),
    }));

    const wasteByDate = new Map();
    for (const row of wasteLog) {
      if (!wasteByDate.has(row.date)) {
        wasteByDate.set(row.date, {
          date: row.date,
          rows: [],
          retailTotal: 0,
          wholesaleTotal: 0,
        });
      }
      const group = wasteByDate.get(row.date);
      group.rows.push(row);
      group.retailTotal += row.retail;
      group.wholesaleTotal += row.wholesale;
    }
    const wasteLogByDate = [...wasteByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const wasteGrandTotals = wasteLogByDate.reduce(
      (acc, day) => ({
        retail: acc.retail + day.retailTotal,
        wholesale: acc.wholesale + day.wholesaleTotal,
      }),
      { retail: 0, wholesale: 0 }
    );

    const inventory = reportState.inventoryRows.map((r, idx) => ({
      id: `${r.log_date}-${idx}`,
      date: r.log_date,
      countType: r.count_frequency ?? "—",
      submittedBy: r.submitted_by ?? "—",
      total: toNum(r.total_value),
      category: r.category ?? "Other",
    }));

    const roastByDate = new Map();
    for (const r of reportState.roastRows) {
      const date = r.sheet_date;
      if (!roastByDate.has(date)) {
        roastByDate.set(date, {
          date,
          put6: 0,
          put10: 0,
          put2: 0,
          put5: 0,
          closeOnHand: 0,
          totalUsed: 0,
          amDpr: 0,
          pmDpr: 0,
        });
      }
      const row = roastByDate.get(date);
      const key = String(r.daypart || "").toLowerCase();
      if (key === "6am") row.put6 = toNum(r.put_in);
      if (key === "10am") row.put10 = toNum(r.put_in);
      if (key === "2pm") row.put2 = toNum(r.put_in);
      if (key === "5pm") row.put5 = toNum(r.put_in);
      if (key === "close") row.closeOnHand = toNum(r.on_hand);
    }
    const roast = [...roastByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    return { daily, salesDetailByDate, laborDetail, wasteLog, wasteLogByDate, wasteGrandTotals, inventory, roast };
  }, [reportState]);

  function formatSubmittedAt(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "unknown time";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function deploymentStatusBadge(log) {
    if (!log) return "— none";
    if (log.is_late) return `⚠️ late${Number(log.minutes_late) > 0 ? ` (${log.minutes_late}m)` : ""}`;
    return "✅";
  }

  const printCurrent = () => {
    window.print();
  };

  const renderReportTable = () => {
    if (reportState.loading) {
      return <div className="px-3 py-3 text-xs text-zinc-500">Loading report...</div>;
    }

    if (reportType === "Daily Summary") {
      return (
        <table className="min-w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Sales</th>
              <th className="px-3 py-2">Labor %</th>
              <th className="px-3 py-2">Waste $</th>
              <th className="px-3 py-2">Avg DT</th>
              <th className="px-3 py-2">Roasts Used</th>
              <th className="px-3 py-2">Deployment</th>
            </tr>
          </thead>
          <tbody>
            {reportRows.daily.map((r) => (
              <tr key={r.date} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{fmtMoney(r.sales)}</td>
                <td className="px-3 py-2">{fmtPct(r.laborPct)}</td>
                <td className="px-3 py-2">{fmtMoney(r.waste)}</td>
                <td className="px-3 py-2">{mmssFromSec(r.dtAvg)}</td>
                <td className="px-3 py-2">{r.roastsUsed}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span>Morning: {deploymentStatusBadge(r.morningDeployment)}</span>
                    <span>Night: {deploymentStatusBadge(r.nightDeployment)}</span>
                  </div>
                </td>
              </tr>
            ))}
            {reportRows.daily.length ? (
              <tr className="border-t-2 border-zinc-300 font-semibold dark:border-zinc-600">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2">{fmtMoney(reportRows.daily.reduce((s, r) => s + r.sales, 0))}</td>
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2">{fmtMoney(reportRows.daily.reduce((s, r) => s + r.waste, 0))}</td>
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2">—</td>
              </tr>
            ) : (
              <tr><td className="px-3 py-3 text-zinc-500" colSpan={7}>Daily Summary data not yet connected</td></tr>
            )}
          </tbody>
        </table>
      );
    }

    if (reportType === "Sales Detail") {
      return (
        <table className="min-w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Hour</th><th className="px-3 py-2">Net Sales</th></tr></thead>
          <tbody>
            {reportRows.salesDetailByDate.flatMap((day) => [
              ...day.rows.map((r, idx) => (
                <tr key={`${day.date}-${r.hour}`} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2">{idx === 0 ? day.date : ""}</td><td className="px-3 py-2">{r.label}</td><td className="px-3 py-2">{fmtMoney2(r.sales)}</td></tr>
              )),
              <tr key={`subtotal-${day.date}`} className="border-t border-zinc-300 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-800/70">
                <td className="px-3 py-2" colSpan={2}>Subtotal for {day.date}</td>
                <td className="px-3 py-2">{fmtMoney2(day.subtotal)}</td>
              </tr>,
            ])}
            {reportRows.salesDetailByDate.length === 0 ? <tr><td className="px-3 py-3 text-zinc-500" colSpan={3}>No hourly sales data for this date range</td></tr> : null}
          </tbody>
        </table>
      );
    }

    if (reportType === "Labor Detail") {
      return (
        <table className="min-w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2">Wage</th><th className="px-3 py-2">Shift Cost</th></tr></thead>
          <tbody>
            {reportRows.laborDetail.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2">{r.date}</td><td className="px-3 py-2">{r.employee}</td><td className="px-3 py-2">{r.hours.toFixed(2)}</td><td className="px-3 py-2">{fmtMoney2(r.wage)}</td><td className="px-3 py-2">{fmtMoney2(r.cost)}</td></tr>
            ))}
            {reportRows.laborDetail.length === 0 ? <tr><td className="px-3 py-3 text-zinc-500" colSpan={5}>Labor Detail data not yet connected</td></tr> : null}
          </tbody>
        </table>
      );
    }

    if (reportType === "Waste Log") {
      return (
        <table className="min-w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Shift</th><th className="px-3 py-2">Submitted By</th><th className="px-3 py-2">Item Name</th><th className="px-3 py-2">Quantity</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">Retail Loss</th><th className="px-3 py-2">Wholesale Cost</th></tr></thead>
          <tbody>
            {reportRows.wasteLogByDate.flatMap((day) => [
              ...day.rows.map((r, idx) => (
                <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2">{idx === 0 ? r.date : ""}</td><td className="px-3 py-2">{r.shift}</td><td className="px-3 py-2">{r.submittedBy}</td><td className="px-3 py-2">{r.item}</td><td className="px-3 py-2">{r.qty}</td><td className="px-3 py-2">{r.unit}</td><td className="px-3 py-2">{fmtMoney2(r.retail)}</td><td className="px-3 py-2">{fmtMoney2(r.wholesale)}</td></tr>
              )),
              <tr key={`subtotal-${day.date}`} className="border-t border-zinc-300 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-800/70">
                <td className="px-3 py-2" colSpan={6}>Subtotal for {day.date}</td>
                <td className="px-3 py-2">{fmtMoney2(day.retailTotal)}</td>
                <td className="px-3 py-2">{fmtMoney2(day.wholesaleTotal)}</td>
              </tr>,
            ])}
            {reportRows.wasteLogByDate.length ? (
              <tr className="border-t-2 border-zinc-400 font-semibold dark:border-zinc-600">
                <td className="px-3 py-2" colSpan={6}>Grand Total</td>
                <td className="px-3 py-2">{fmtMoney2(reportRows.wasteGrandTotals.retail)}</td>
                <td className="px-3 py-2">{fmtMoney2(reportRows.wasteGrandTotals.wholesale)}</td>
              </tr>
            ) : null}
            {reportRows.wasteLogByDate.length === 0 ? <tr><td className="px-3 py-3 text-zinc-500" colSpan={8}>Waste Log data not yet connected</td></tr> : null}
          </tbody>
        </table>
      );
    }

    if (reportType === "Inventory Counts") {
      return (
        <table className="min-w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Count Type</th><th className="px-3 py-2">Submitted By</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Total Value</th></tr></thead>
          <tbody>
            {reportRows.inventory.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2">{r.date}</td><td className="px-3 py-2">{r.countType}</td><td className="px-3 py-2">{r.submittedBy}</td><td className="px-3 py-2">{r.category}</td><td className="px-3 py-2">{fmtMoney2(r.total)}</td></tr>
            ))}
            {reportRows.inventory.length === 0 ? <tr><td className="px-3 py-3 text-zinc-500" colSpan={5}>Inventory Counts data not yet connected</td></tr> : null}
          </tbody>
        </table>
      );
    }

    return (
      <table className="min-w-full text-left text-xs">
        <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">6am Put In</th><th className="px-3 py-2">10am Put In</th><th className="px-3 py-2">2pm Put In</th><th className="px-3 py-2">5pm Put In</th><th className="px-3 py-2">Close On Hand</th><th className="px-3 py-2">Total Used</th><th className="px-3 py-2">AM $/roast</th><th className="px-3 py-2">PM $/roast</th></tr></thead>
        <tbody>
          {reportRows.roast.map((r) => (
            <tr key={r.date} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2">{r.date}</td><td className="px-3 py-2">{r.put6}</td><td className="px-3 py-2">{r.put10}</td><td className="px-3 py-2">{r.put2}</td><td className="px-3 py-2">{r.put5}</td><td className="px-3 py-2">{r.closeOnHand}</td><td className="px-3 py-2">{r.totalUsed}</td><td className="px-3 py-2">{fmtMoney2(r.amDpr)}</td><td className="px-3 py-2">{fmtMoney2(r.pmDpr)}</td></tr>
          ))}
          {reportRows.roast.length === 0 ? <tr><td className="px-3 py-3 text-zinc-500" colSpan={9}>Roast Beef Log data not yet connected</td></tr> : null}
        </tbody>
      </table>
    );
  };

  const today = todayLocalISODate();
  const laborColor = colorByLaborPct(snapshot.laborPct);
  const wasteColor = colorByWasteDollar(snapshot.wasteRetail);
  const hasSalesComparison = Number.isFinite(snapshot.salesDiffPct);
  const hasDtComparison = Number.isFinite(snapshot.dtDiffPct);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-5">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {["DASHBOARD", "REPORTS"].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`rounded-lg py-2 text-sm font-bold ${tab === name ? "bg-[#C8102E] text-white" : "text-zinc-700 dark:text-zinc-300"}`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "DASHBOARD" ? (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date Selector</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="button"
                onClick={() => setSelectedDate(today)}
                className="rounded-lg border border-[#C8102E] px-3 py-2 text-sm font-semibold text-[#C8102E]"
              >
                Today
              </button>
            </div>
          </section>

          {state.loading ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">Loading dashboard...</div>
          ) : (
            <>
              <section>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#C8102E]">Daily Snapshot</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {state.disconnected.sales || !snapshot.hasSalesData ? (
                    <SalesImportEmptyState />
                  ) : (
                    <MetricCard
                      title="Sales"
                      value={fmtMoney(snapshot.salesTotal)}
                      sub={`vs same day last week: ${fmtSignedPct(snapshot.salesDiffPct)}`}
                      subColor={
                        !hasSalesComparison
                          ? "text-zinc-500 dark:text-zinc-400"
                          : snapshot.salesDiffPct >= 0
                          ? "text-green-700 dark:text-green-400"
                          : "text-red-700 dark:text-red-400"
                      }
                    />
                  )}
                  {state.disconnected.labor || state.laborRows.length === 0 ? (
                    <EmptyState title="Labor" />
                  ) : (
                    <MetricCard
                      title="Labor %"
                      value={fmtPct(snapshot.laborPct)}
                      sub={`Labor cost ${fmtMoney(snapshot.laborCost)}`}
                      color=""
                    />
                  )}
                  {state.disconnected.waste || state.wasteRows.length === 0 ? (
                    <EmptyState title="Waste" />
                  ) : (
                    <MetricCard
                      title="Waste"
                      value={fmtMoney(snapshot.wasteRetail)}
                      sub={`Waste % of sales ${fmtPct(snapshot.wastePct)}`}
                    />
                  )}
                  {state.disconnected.dt || !snapshot.hasDtData ? (
                    <DtEmptyState />
                  ) : (
                    <MetricCard
                      title="DT Time"
                      value={mmssFromSec(snapshot.dtAvgSec)}
                      sub={`Total cars ${snapshot.totalCars}`}
                      color={colorByDtSec(snapshot.dtAvgSec) === GREEN ? "text-green-700 dark:text-green-400" : colorByDtSec(snapshot.dtAvgSec) === YELLOW ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}
                      subColor={colorByDtSec(snapshot.dtAvgSec) === GREEN ? "text-green-700 dark:text-green-400" : colorByDtSec(snapshot.dtAvgSec) === YELLOW ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}
                    />
                  )}
                </div>
              </section>

              <Expandable
                title="Labor Detail"
                summary={
                  <span>
                    <span className="font-semibold" style={{ color: laborColor }}>{fmtPct(snapshot.laborPct)}</span> · {snapshot.laborHours.toFixed(1)} hrs · {fmtMoney(snapshot.laborCost)}
                  </span>
                }
                open={expanded.labor}
                setOpen={(v) => setExpanded((s) => ({ ...s, labor: typeof v === "function" ? v(s.labor) : v }))}
                empty={state.disconnected.labor || state.laborRows.length === 0}
              >
                <div className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  <p>Target: 22% ({snapshot.laborPct >= 22 ? "+" : ""}{(snapshot.laborPct - 22).toFixed(1)} pts)</p>
                  <p>Total hours: {snapshot.laborHours.toFixed(1)}</p>
                  <p>Total labor cost: {fmtMoney(snapshot.laborCost)}</p>
                  <p>Sales per labor hour: {fmtMoney2(snapshot.splh)}</p>
                  <p className="text-xs text-zinc-500">Full employee breakdown available in Reports</p>
                </div>
              </Expandable>

              <Expandable
                title="Sales Detail"
                summary={`${fmtMoney(snapshot.salesTotal)} · txns — · avg ticket —`}
                open={expanded.sales}
                setOpen={(v) => setExpanded((s) => ({ ...s, sales: typeof v === "function" ? v(s.sales) : v }))}
                empty={state.disconnected.sales || !snapshot.hasSalesData}
              >
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={snapshot.salesByHour}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(v) => fmtMoney2(toNum(v))} />
                      <Bar dataKey="sales" fill={ARBY_RED} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">Peak hour: {snapshot.peak.label} — {fmtMoney(snapshot.peak.sales)}</p>
                {hasSalesComparison ? (
                  <p className="text-sm text-zinc-500">
                    vs same day last week: {snapshot.salesDiffDollar >= 0 ? "+" : "-"}
                    {fmtMoney2(Math.abs(snapshot.salesDiffDollar))} ({fmtSignedPct(snapshot.salesDiffPct)})
                  </p>
                ) : (
                  <p className="text-sm text-zinc-500">vs same day last week: —</p>
                )}
              </Expandable>

              <Expandable
                title="DT Detail"
                summary={
                  <span>
                    <span className="font-semibold" style={{ color: colorByDtSec(snapshot.dtAvgSec) }}>
                      {mmssFromSec(snapshot.dtAvgSec)}
                    </span>{" "}
                    · {snapshot.totalCars} cars
                  </span>
                }
                open={expanded.dt}
                setOpen={(v) => setExpanded((s) => ({ ...s, dt: typeof v === "function" ? v(s.dt) : v }))}
                empty={false}
              >
                {state.disconnected.dt || !snapshot.hasDtData ? (
                  <DtEmptyState />
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <p>Lane total (weighted): {mmssFromSec(snapshot.dtAvgSec)}</p>
                      <p>Total cars: {snapshot.totalCars}</p>
                      <p>Peak hour: {snapshot.peakDtHour.label} — {snapshot.peakDtHour.cars} cars</p>
                      <p>
                        Slowest hour: {snapshot.slowestDtHour.label} — {snapshot.slowestDtHour.label === "--" ? "—" : mmssFromSec(snapshot.slowestDtHour.avgSec)}
                      </p>
                    </div>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={snapshot.dtByHour}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" />
                          <YAxis />
                          <Tooltip formatter={(v) => mmssFromSec(toNum(v))} />
                          <ReferenceLine y={270} stroke={RED} strokeDasharray="4 4" />
                          <Bar dataKey="avgSec">
                            {snapshot.dtByHour.map((row) => (
                              <Cell key={row.hour} fill={row.barColor} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {hasDtComparison ? (
                      <p className="text-sm text-zinc-500">
                        vs same day last week: {snapshot.dtDiffSec >= 0 ? "+" : "-"}
                        {mmssFromSec(Math.abs(snapshot.dtDiffSec))} ({fmtSignedPct(snapshot.dtDiffPct)})
                      </p>
                    ) : (
                      <p className="text-sm text-zinc-500">vs same day last week: —</p>
                    )}
                  </div>
                )}
              </Expandable>

              <Expandable
                title="Waste Detail"
                summary={<span><span className="font-semibold" style={{ color: wasteColor }}>{fmtMoney(snapshot.wasteRetail)}</span> · {fmtPct(snapshot.wastePct)} of sales</span>}
                open={expanded.waste}
                setOpen={(v) => setExpanded((s) => ({ ...s, waste: typeof v === "function" ? v(s.waste) : v }))}
                empty={state.disconnected.waste || state.wasteRows.length === 0}
              >
                <div className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  <p>Retail loss: {fmtMoney(snapshot.wasteRetail)}</p>
                  <p>Wholesale cost: {fmtMoney(snapshot.wasteWholesale)}</p>
                  <p>
                    Waste % of sales:{" "}
                    <span style={{ color: colorByWastePct(snapshot.wastePct), fontWeight: 700 }}>{fmtPct(snapshot.wastePct)}</span>
                  </p>
                  <p>Top offender: {snapshot.topWaste[0]} ({fmtMoney2(snapshot.topWaste[1])})</p>
                  {String(snapshot.topWaste[0]).toLowerCase().includes("fries") ? (
                    <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">⚠ Fries are your #1 waste item — check thaw schedule</p>
                  ) : null}
                  <div className="h-14 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weekSummary}>
                        <Line type="monotone" dataKey="waste" stroke={ARBY_RED} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Expandable>

              <Expandable
                title="Roast Beef Detail"
                summary={`${snapshot.roast.totalRoastUsed.toFixed(1)} roasts used · ${fmtMoney2(snapshot.roast.blendedDpr)}/roast`}
                open={expanded.roast}
                setOpen={(v) => setExpanded((s) => ({ ...s, roast: typeof v === "function" ? v(s.roast) : v }))}
                empty={state.disconnected.roast || state.roastRows.length === 0}
              >
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <p>6am put in: {snapshot.roast.put6}</p>
                  <p>10am put in: {snapshot.roast.put10}</p>
                  <p>2pm put in: {snapshot.roast.put2}</p>
                  <p>5pm put in: {snapshot.roast.put5}</p>
                  <p>Close on hand: {snapshot.roast.ohClose}</p>
                  <p>Total used: {snapshot.roast.totalRoastUsed.toFixed(1)}</p>
                  <p>AM $/roast: {fmtMoney2(snapshot.roast.amDpr)}</p>
                  <p>PM $/roast: {fmtMoney2(snapshot.roast.pmDpr)}</p>
                </div>
              </Expandable>

              <Expandable
                title="Deployment"
                titleClassName={deploymentSnapshot.hasAny ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}
                summary={
                  deploymentSnapshot.hasAny ? (
                    `Morning: ${deploymentSnapshot.morningAssignments.length} people | Night: ${deploymentSnapshot.nightAssignments.length} people`
                  ) : (
                    "No deployment recorded"
                  )
                }
                open={expanded.deployment}
                setOpen={(v) => setExpanded((s) => ({ ...s, deployment: typeof v === "function" ? v(s.deployment) : v }))}
                empty={false}
              >
                {!deploymentSnapshot.hasAny ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    <p className="font-semibold">No deployment recorded for this date</p>
                    <p className="mt-1 text-xs">Deployment charts are submitted by shift leads at /deployment</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <h3 className="text-sm font-bold text-[#C8102E]">MORNING DEPLOYMENT</h3>
                      {deploymentSnapshot.morningLog ? (
                        <>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                            Submitted by {deploymentSnapshot.morningLog.submitted_by || "—"} at {formatSubmittedAt(deploymentSnapshot.morningLog.submitted_at)}
                          </p>
                          <p className="text-xs">
                            {deploymentSnapshot.morningLog.is_late ? (
                              <span className="font-semibold text-amber-700">Late ⚠️ {Number(deploymentSnapshot.morningLog.minutes_late) || 0} min late</span>
                            ) : (
                              <span className="font-semibold text-green-700">On time ✅</span>
                            )}
                          </p>
                          <div className="mt-2 overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead className="bg-zinc-50 dark:bg-zinc-900">
                                <tr>
                                  <th className="px-2 py-1 text-left">Name</th>
                                  <th className="px-2 py-1 text-left">Stations</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deploymentSnapshot.morningAssignments.map((row, idx) => (
                                  <tr key={`${row.id || idx}`} className="border-t border-zinc-100 dark:border-zinc-800">
                                    <td className="px-2 py-1">{row.employee_name}</td>
                                    <td className="px-2 py-1">{Array.isArray(row.stations) ? row.stations.join(", ") : String(row.stations || "—")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">Morning deployment not yet submitted</p>
                      )}
                    </section>

                    <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <h3 className="text-sm font-bold text-[#C8102E]">NIGHT DEPLOYMENT</h3>
                      {deploymentSnapshot.nightLog ? (
                        <>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                            Submitted by {deploymentSnapshot.nightLog.submitted_by || "—"} at {formatSubmittedAt(deploymentSnapshot.nightLog.submitted_at)}
                          </p>
                          <p className="text-xs">
                            {deploymentSnapshot.nightLog.is_late ? (
                              <span className="font-semibold text-amber-700">Late ⚠️ {Number(deploymentSnapshot.nightLog.minutes_late) || 0} min late</span>
                            ) : (
                              <span className="font-semibold text-green-700">On time ✅</span>
                            )}
                          </p>
                          <div className="mt-2 overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead className="bg-zinc-50 dark:bg-zinc-900">
                                <tr>
                                  <th className="px-2 py-1 text-left">Name</th>
                                  <th className="px-2 py-1 text-left">Stations</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deploymentSnapshot.nightAssignments.map((row, idx) => (
                                  <tr key={`${row.id || idx}`} className="border-t border-zinc-100 dark:border-zinc-800">
                                    <td className="px-2 py-1">{row.employee_name}</td>
                                    <td className="px-2 py-1">{Array.isArray(row.stations) ? row.stations.join(", ") : String(row.stations || "—")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">Night deployment not yet submitted</p>
                      )}
                    </section>
                  </div>
                )}
              </Expandable>

              <Expandable
                title="Inventory Detail"
                summary={`Last count: ${selectedDate} · ${fmtMoney(snapshot.inventory.total)}`}
                open={expanded.inventory}
                setOpen={(v) => setExpanded((s) => ({ ...s, inventory: typeof v === "function" ? v(s.inventory) : v }))}
                empty={state.disconnected.inventory}
              >
                {state.inventoryRows.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">No inventory count recorded for this date. Data will appear once connected.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p>Total inventory value: {fmtMoney(snapshot.inventory.total)}</p>
                    <p className="text-xs text-zinc-600">
                      {snapshot.inventory.categories.map(([cat, val]) => `${cat} ${fmtMoney(val)}`).join(" | ")}
                    </p>
                  </div>
                )}
              </Expandable>

              <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#C8102E]">Weekly Summary</h2>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[560px] grid-cols-7 gap-2">
                    {weekSummary.map((d) => {
                      const dayLabel = new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
                      const isToday = d.date === today;
                      return (
                        <div key={d.date} className={`rounded-lg border p-2 text-xs ${isToday ? "border-[#C8102E]" : "border-zinc-200 dark:border-zinc-700"}`}>
                          <p className="font-semibold">{dayLabel}</p>
                          <p>{d.sales ? fmtMoney(d.sales) : "—"}</p>
                          <p className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorByLaborPct(d.laborPct) }} />
                            {d.sales ? fmtPct(d.laborPct) : "—"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <p>Week total sales: {fmtMoney(weekAgg.weekSales)}</p>
                  <p>Week avg labor %: {fmtPct(weekAgg.laborAvg)}</p>
                  <p>Week total waste: {fmtMoney(weekAgg.weekWaste)}</p>
                  <p>Week avg DT time: {mmssFromSec(weekAgg.dtAvgSec)}</p>
                </div>
              </section>
            </>
          )}
        </>
      ) : (
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-600">
              Start date
              <input type="date" value={reportStart} onChange={(e) => setReportStart(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
            </label>
            <label className="text-xs text-zinc-600">
              End date
              <input type="date" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {REPORT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setReportType(type)}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold ${reportType === type ? "border-[#C8102E] bg-[#C8102E] text-white" : "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"}`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={printCurrent} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
              PRINT
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            {renderReportTable()}
          </div>
        </section>
      )}
    </div>
  );
}
