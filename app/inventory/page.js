"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const CATEGORY_ORDER = [
  "Protein",
  "Bread",
  "Sides",
  "Fresh",
  "Sauce",
  "Syrup",
  "Beverage",
  "LTO",
];

const COUNT_TYPES = ["Daily", "Weekly", "Monthly"];

function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoney(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(n) ? n : 0);
}

function formatFetchError(error) {
  if (!error) return "Unknown error (no details).";
  const lines = [];
  if (error.message) lines.push(error.message);
  if (error.code) lines.push(`Code: ${error.code}`);
  if (error.details) lines.push(`Details: ${error.details}`);
  if (error.hint) lines.push(`Hint: ${error.hint}`);
  return lines.length ? lines.join("\n") : String(error);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function itemName(item) {
  return item.item_name ?? item.name ?? "Item";
}

function itemCategory(item) {
  return CATEGORY_ORDER.includes(item.category) ? item.category : "LTO";
}

function casesLooseValue(item, entry) {
  const cases = toNonNegInt(entry?.cases);
  const loose = toNonNegInt(entry?.loose);
  const bagsPerCase = toNumber(item.bags_per_case);
  const bagCost = toNumber(item.bag_wholesale_cost);
  return (cases * bagsPerCase + loose) * bagCost;
}

function isFullHalfStyle(item) {
  return item.count_type === "full_half" || toNumber(item.bags_per_case) === 1;
}

function fullHalfValue(item, entry) {
  const fullCases = toNonNegInt(entry?.cases);
  const halfYes = (entry?.fullHalf ?? "no") === "yes";
  const caseCost = toNumber(item.case_wholesale_cost);
  return fullCases * caseCost + (halfYes ? caseCost / 2 : 0);
}

function groupByCategory(items) {
  const buckets = new Map(CATEGORY_ORDER.map((cat) => [cat, []]));
  for (const item of items) {
    buckets.get(itemCategory(item)).push(item);
  }
  return CATEGORY_ORDER.filter((cat) => buckets.get(cat).length > 0).map(
    (cat) => [cat, buckets.get(cat)]
  );
}

export default function InventoryPage() {
  const [items, setItems] = useState([]);
  const [loadState, setLoadState] = useState({ status: "loading", message: "" });
  const [fetchKey, setFetchKey] = useState(0);

  const [logDate, setLogDate] = useState(todayLocalISODate);
  const [countFrequency, setCountFrequency] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");

  const [casesLooseById, setCasesLooseById] = useState({});
  const [fullHalfById, setFullHalfById] = useState({});

  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadState({ status: "loading", message: "" });
      setItems([]);
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url?.trim() || !key?.trim()) {
          if (!cancelled) {
            setLoadState({
              status: "error",
              message:
                "Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in .env.local and restart the dev server.",
            });
          }
          return;
        }

        const { data, error } = await getSupabase()
          .from("inventory_items")
          .select("*")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (cancelled) return;

        if (error) {
          setLoadState({ status: "error", message: formatFetchError(error) });
          return;
        }

        const rows = data ?? [];
        if (rows.length === 0) {
          setLoadState({
            status: "empty",
            message:
              "inventory_items returned no rows. The table may be empty, or Row Level Security may be blocking SELECT.",
          });
          return;
        }

        setItems(rows);
        setLoadState({ status: "ready", message: "" });
      } catch (e) {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: e instanceof Error ? e.message : "Unexpected load error.",
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  const retryFetch = useCallback(() => setFetchKey((k) => k + 1), []);

  const grouped = useMemo(() => groupByCategory(items), [items]);

  const totals = useMemo(() => {
    let totalValue = 0;
    const byCategory = Object.fromEntries(CATEGORY_ORDER.map((cat) => [cat, 0]));

    for (const item of items) {
      let itemTotal = 0;
      if (isFullHalfStyle(item)) {
        itemTotal = fullHalfValue(item, fullHalfById[item.id] || {});
      } else if (item.count_type === "cases_loose") {
        itemTotal = casesLooseValue(item, casesLooseById[item.id]);
      }
      const cat = itemCategory(item);
      byCategory[cat] += itemTotal;
      totalValue += itemTotal;
    }
    return { totalValue, byCategory };
  }, [items, casesLooseById, fullHalfById]);

  const resetForm = useCallback(() => {
    setLogDate(todayLocalISODate());
    setCountFrequency("");
    setSubmittedBy("");
    setCasesLooseById({});
    setFullHalfById({});
    setSubmitError("");
    setConfirmation(null);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    if (!logDate) {
      setSubmitError("Please select a date.");
      return;
    }
    if (!countFrequency) {
      setSubmitError("Please select count type (Daily, Weekly, or Monthly).");
      return;
    }
    if (!submittedBy.trim()) {
      setSubmitError('Please fill in "Submitted By".');
      return;
    }

    const rows = [];
    let totalForSubmission = 0;

    for (const item of items) {
      const base = {
        item_id: item.id,
        item_name: itemName(item),
        category: itemCategory(item),
        count_type: item.count_type,
        log_date: logDate,
        count_frequency: countFrequency.toLowerCase(),
        submitted_by: submittedBy.trim(),
      };

      if (isFullHalfStyle(item)) {
        const entry = fullHalfById[item.id] || {};
        const casesCounted = toNonNegInt(entry.cases);
        const fullHalf = (entry.fullHalf ?? "no") === "yes" ? "yes" : "no";
        if (casesCounted <= 0 && fullHalf === "no") continue;

        const caseCost = toNumber(item.case_wholesale_cost);
        const totalValue =
          casesCounted * caseCost + (fullHalf === "yes" ? caseCost / 2 : 0);
        rows.push({
          ...base,
          cases_counted: casesCounted,
          full_half: fullHalf,
          total_value: totalValue,
        });
        totalForSubmission += totalValue;
        continue;
      }

      if (item.count_type === "cases_loose") {
        const entry = casesLooseById[item.id] || {};
        const casesCounted = toNonNegInt(entry.cases);
        const bagsCounted = toNonNegInt(entry.loose);
        if (casesCounted <= 0 && bagsCounted <= 0) continue;

        const bagsPerCase = toNumber(item.bags_per_case);
        const bagCost = toNumber(item.bag_wholesale_cost);
        const totalBags = casesCounted * bagsPerCase + bagsCounted;
        const totalValue = totalBags * bagCost;

        rows.push({
          ...base,
          cases_counted: casesCounted,
          bags_counted: bagsCounted,
          total_bags: totalBags,
          total_value: totalValue,
        });
        totalForSubmission += totalValue;
        continue;
      }

      // Unknown item count_type is ignored.
    }

    if (rows.length === 0) {
      setSubmitError("Enter at least one inventory count before submitting.");
      return;
    }

    setSubmitting(true);
    const { error } = await getSupabase().from("inventory_logs").insert(rows);
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message || "Submit failed. Try again.");
      return;
    }

    setConfirmation({
      logDate,
      submittedBy: submittedBy.trim(),
      countFrequency,
      itemCount: rows.length,
      totalValue: totalForSubmission,
    });
  }

  if (confirmation) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Inventory submission recorded
          </p>
          <dl className="mt-4 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                {confirmation.logDate}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Count type</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                {confirmation.countFrequency}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Submitted by</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                {confirmation.submittedBy}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Items counted</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                {confirmation.itemCount}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <dt className="text-zinc-500 dark:text-zinc-400">
                Total Inventory Value
              </dt>
              <dd className="text-lg font-semibold text-[#C8102E]">
                {formatMoney(confirmation.totalValue)}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={resetForm}
            className="mt-6 w-full rounded-lg bg-zinc-900 py-3 text-base font-medium text-white shadow-sm active:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:active:bg-zinc-200"
          >
            Submit Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-md flex-1 flex-col"
    >
      <div className="flex-1 space-y-6 px-4 pb-48 pt-6">
        {loadState.status === "loading" && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Loading inventory items...
            </p>
          </div>
        )}

        {loadState.status === "error" && (
          <div className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
            <p className="text-sm font-semibold text-red-900 dark:text-red-100">
              Could not load inventory items
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-red-800 dark:text-red-200">
              {loadState.message}
            </pre>
            <button
              type="button"
              onClick={retryFetch}
              className="w-full rounded-lg border border-red-300 bg-white py-2.5 text-sm font-medium text-red-900 active:bg-red-100 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {loadState.status === "empty" && (
          <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
              No inventory items to show
            </p>
            <p className="whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">
              {loadState.message}
            </p>
            <button
              type="button"
              onClick={retryFetch}
              className="w-full rounded-lg border border-amber-400 bg-white py-2.5 text-sm font-medium text-amber-950 active:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100"
            >
              Retry
            </button>
          </div>
        )}

        {loadState.status === "ready" && (
          <>
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <label
                  htmlFor="inventory-date"
                  className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Date
                </label>
                <input
                  id="inventory-date"
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </div>

              <div>
                <span className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Count Type
                </span>
                <div className="mt-1 grid grid-cols-3 gap-2" role="group">
                  {COUNT_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setCountFrequency(type)}
                      className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                        countFrequency === type
                          ? "border-[#C8102E] bg-[#C8102E] text-white"
                          : "border-zinc-200 bg-white text-zinc-800 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="inventory-submitted-by"
                  className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Submitted By
                </label>
                <input
                  id="inventory-submitted-by"
                  type="text"
                  autoComplete="name"
                  placeholder="Employee name"
                  value={submittedBy}
                  onChange={(e) => setSubmittedBy(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </div>
            </div>

            {grouped.map(([category, categoryItems]) => (
              <section key={category} className="space-y-3">
                <h2 className="text-base font-bold text-[#C8102E]">{category}</h2>
                <ul className="space-y-3">
                  {categoryItems.map((item) => {
                    const id = item.id;
                    const name = itemName(item);
                    const countType = item.count_type;

                    if (!isFullHalfStyle(item) && countType === "cases_loose") {
                      const entry = casesLooseById[id] || { cases: "", loose: "" };
                      const value = casesLooseValue(item, entry);
                      return (
                        <li
                          key={id}
                          className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {name}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {item.bag_description || " "}
                          </p>
                          <div className="mt-3 flex items-end gap-2">
                            <label className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                              Cases
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                value={entry.cases}
                                onChange={(e) =>
                                  setCasesLooseById((prev) => ({
                                    ...prev,
                                    [id]: { ...entry, cases: e.target.value },
                                  }))
                                }
                                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                              />
                            </label>
                            <label className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                              Loose (bags)
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                value={entry.loose}
                                onChange={(e) =>
                                  setCasesLooseById((prev) => ({
                                    ...prev,
                                    [id]: { ...entry, loose: e.target.value },
                                  }))
                                }
                                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                              />
                            </label>
                            <div className="shrink-0 pb-2 text-right text-sm font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                              {formatMoney(value)}
                            </div>
                          </div>
                        </li>
                      );
                    }

                    const entry = fullHalfById[id] || { cases: "", fullHalf: "no" };
                    const value = fullHalfValue(item, entry);
                    return (
                      <li
                        key={id}
                        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {name}
                        </p>
                        <div className="mt-3 flex items-end gap-2">
                          <label className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Full Cases
                            <input
                              type="number"
                              min={0}
                              step={1}
                              inputMode="numeric"
                              value={entry.cases}
                              onChange={(e) =>
                                setFullHalfById((prev) => ({
                                  ...prev,
                                  [id]: { ...entry, cases: e.target.value },
                                }))
                              }
                              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                            />
                          </label>
                          <div className="min-w-[9.5rem]">
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                              1/2 Case?
                            </span>
                            <div className="mt-1 grid grid-cols-2 gap-1.5">
                              {["yes", "no"].map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() =>
                                    setFullHalfById((prev) => ({
                                      ...prev,
                                      [id]: { ...entry, fullHalf: opt },
                                    }))
                                  }
                                  className={`rounded-lg border py-2 text-xs font-semibold uppercase ${
                                    (entry.fullHalf ?? "no") === opt
                                      ? "border-[#C8102E] bg-[#C8102E] text-white"
                                      : "border-zinc-200 bg-white text-zinc-800 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="mt-3 text-right text-sm font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                          {formatMoney(value)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-zinc-200 bg-white/95 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/95 dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)]">
        <div className="mx-auto w-full max-w-md space-y-2">
          {submitError ? (
            <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {submitError}
            </p>
          ) : null}

          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total Inventory Value
            </span>
            <span className="text-2xl font-bold tabular-nums text-[#C8102E]">
              {formatMoney(totals.totalValue)}
            </span>
          </div>

          <div className="overflow-x-auto whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
            {CATEGORY_ORDER.map((cat) => (
              <span key={cat} className="mr-3 inline-block">
                {cat} {formatMoney(totals.byCategory[cat] || 0)}
              </span>
            ))}
          </div>

          <button
            type="submit"
            disabled={loadState.status !== "ready" || submitting || items.length === 0}
            className="mt-3 w-full rounded-lg bg-zinc-900 py-3.5 text-base font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 active:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:active:bg-zinc-200"
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </footer>
    </form>
  );
}
