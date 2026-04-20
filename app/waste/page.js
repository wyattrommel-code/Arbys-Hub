"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const CATEGORY_ORDER = ["Proteins", "Bread", "Sides", "Other"];

const SANDWICH_OPTIONS = [
  { name: "Classic Roast Beef", price: 4.59 },
  { name: "Double Roast Beef", price: 5.99 },
  { name: "Half Pound Roast Beef", price: 7.19 },
  { name: "Classic Beef n Cheddar", price: 5.49 },
  { name: "Double Beef n Cheddar", price: 6.99 },
  { name: "Half Pound Beef n Cheddar", price: 8.19 },
  { name: "Classic Bacon Beef n Cheddar", price: 6.19 },
  { name: "Gyro (Beef/Turkey/Greek)", price: 5.99 },
  { name: "Reuben (CB/Turkey)", price: 7.49 },
  { name: "Double Reuben", price: 9.29 },
  { name: "French Dip & Swiss", price: 6.49 },
  { name: "Half Pound French Dip", price: 8.99 },
  { name: "MF Turkey & Swiss", price: 7.99 },
  { name: "MF Turkey Bacon Ranch", price: 8.19 },
  { name: "Crispy Chicken Wrap", price: 7.99 },
  { name: "Smokehouse Brisket", price: 7.99 },
  { name: "Deluxe Burger", price: 6.99 },
  { name: "Cheesy Big Bacon Burger", price: 7.99 },
  { name: "Sausage Biscuit", price: 2.49 },
  { name: "Bacon Biscuit", price: 2.49 },
  { name: "Croissant Sandwich", price: 3.29 },
];

function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parsePositiveQty(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function formatMoney(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function effectiveCategory(item) {
  return CATEGORY_ORDER.includes(item.category) ? item.category : "Other";
}

function groupItemsByCategory(items) {
  const buckets = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  for (const item of items) {
    const cat = effectiveCategory(item);
    buckets.get(cat).push(item);
  }
  return CATEGORY_ORDER.filter((c) => buckets.get(c).length > 0).map((c) => [
    c,
    buckets.get(c),
  ]);
}

/** Human-readable Supabase / PostgREST error for on-screen debugging (e.g. mobile). */
function formatFetchError(error) {
  if (!error) return "Unknown error (no details).";
  const lines = [];
  if (error.message) lines.push(error.message);
  if (error.code) lines.push(`Code: ${error.code}`);
  if (error.details) lines.push(`Details: ${error.details}`);
  if (error.hint) lines.push(`Hint: ${error.hint}`);
  return lines.length ? lines.join("\n") : String(error);
}

export default function WastePage() {
  const [items, setItems] = useState([]);
  /** Start loading so first paint is never an empty main area (fixes “blank” before useEffect runs). */
  const [loadState, setLoadState] = useState({ status: "loading", message: "" });
  const [fetchKey, setFetchKey] = useState(0);

  const [logDate, setLogDate] = useState(todayLocalISODate);
  const [shift, setShift] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [quantities, setQuantities] = useState({});
  /** item id -> index in SANDWICH_OPTIONS or -1 if none */
  const [sandwichIdxByItem, setSandwichIdxByItem] = useState({});

  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  // Fetch only on the client after mount (never during SSR).
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

        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("waste_items")
          .select("*")
          .order("sort_order", { ascending: true });

        if (cancelled) return;

        if (error) {
          setLoadState({
            status: "error",
            message: formatFetchError(error),
          });
          return;
        }

        const rows = data ?? [];
        if (rows.length === 0) {
          setLoadState({
            status: "empty",
            message:
              "waste_items returned no rows. The table may be empty, or Row Level Security may be blocking SELECT for the anon key. Check the Supabase dashboard → Table Editor and Authentication → Policies.",
          });
          setSandwichIdxByItem({});
          return;
        }

        setItems(rows);
        const nextSandwich = {};
        for (const row of rows) {
          if (row.is_dropdown) nextSandwich[row.id] = -1;
        }
        setSandwichIdxByItem(nextSandwich);
        setLoadState({ status: "ready", message: "" });
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Unexpected error while loading waste items.";
        setLoadState({
          status: "error",
          message: msg,
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  const retryFetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  const grouped = useMemo(() => groupItemsByCategory(items), [items]);

  const totals = useMemo(() => {
    let retail = 0;
    let wholesale = 0;
    let breadWholesale = 0;
    for (const item of items) {
      const q = parsePositiveQty(quantities[item.id]);
      if (q <= 0) continue;
      const w = Number(item.unit_wholesale_cost) || 0;
      wholesale += q * w;
      if (effectiveCategory(item) === "Bread") {
        breadWholesale += q * w;
        continue;
      }
      if (item.is_dropdown) {
        const idx = sandwichIdxByItem[item.id];
        const opt =
          typeof idx === "number" && idx >= 0 ? SANDWICH_OPTIONS[idx] : null;
        if (opt) retail += q * opt.price;
      } else {
        const r = Number(item.unit_retail_value) || 0;
        retail += q * r;
      }
    }
    return { retail, wholesale, breadWholesale };
  }, [items, quantities, sandwichIdxByItem]);

  const setQty = useCallback((id, value) => {
    setQuantities((prev) => ({ ...prev, [id]: value }));
  }, []);

  const setSandwichForItem = useCallback((id, idxStr) => {
    const idx = idxStr === "" ? -1 : Number(idxStr);
    setSandwichIdxByItem((prev) => ({ ...prev, [id]: idx }));
  }, []);

  const resetForm = useCallback(() => {
    setLogDate(todayLocalISODate());
    setShift("");
    setSubmittedBy("");
    setQuantities({});
    const nextSandwich = {};
    for (const row of items) {
      if (row.is_dropdown) nextSandwich[row.id] = -1;
    }
    setSandwichIdxByItem(nextSandwich);
    setSubmitError("");
    setConfirmation(null);
  }, [items]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    if (!shift) {
      setSubmitError("Please select a shift (AM, Mid, or Night).");
      return;
    }
    if (!submittedBy.trim()) {
      setSubmitError('Please enter your name in "Submitted By".');
      return;
    }

    const rows = [];
    let totalRetailForConfirmation = 0;
    for (const item of items) {
      const q = parsePositiveQty(quantities[item.id]);
      if (q <= 0) continue;

      const base = {
        item_id: item.id,
        item_name: item.item_name ?? item.name,
        quantity: q,
        shift,
        submitted_by: submittedBy.trim(),
        log_date: logDate,
        total_wholesale_cost:
          q * (Number(item.unit_wholesale_cost) || 0),
      };

      if (item.is_dropdown) {
        const idx = sandwichIdxByItem[item.id];
        const opt =
          typeof idx === "number" && idx >= 0 ? SANDWICH_OPTIONS[idx] : null;
        if (!opt) {
          setSubmitError(
            "Select a sandwich type for Whole Sandwiches when quantity is greater than zero."
          );
          return;
        }
        const row = {
          ...base,
          total_retail_loss: q * opt.price,
          sandwich_type: opt.name,
          sandwich_retail_price: opt.price,
        };
        rows.push(row);
        if (effectiveCategory(item) !== "Bread") {
          totalRetailForConfirmation += row.total_retail_loss;
        }
      } else {
        const row = {
          ...base,
          total_retail_loss: q * (Number(item.unit_retail_value) || 0),
        };
        rows.push(row);
        if (effectiveCategory(item) !== "Bread") {
          totalRetailForConfirmation += row.total_retail_loss;
        }
      }
    }

    if (rows.length === 0) {
      setSubmitError("Enter a quantity for at least one item to log waste.");
      return;
    }

    setSubmitting(true);
    const { error } = await getSupabase().from("waste_logs").insert(rows);
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message || "Submit failed. Try again.");
      return;
    }

    setConfirmation({
      shift,
      logDate,
      submittedBy: submittedBy.trim(),
      itemCount: rows.length,
      totalRetailLoss: totalRetailForConfirmation,
    });
  }

  if (confirmation) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Submission recorded
            </p>
            <dl className="mt-4 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                  {confirmation.logDate}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500 dark:text-zinc-400">Shift</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                  {confirmation.shift}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500 dark:text-zinc-400">Submitted by</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                  {confirmation.submittedBy}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500 dark:text-zinc-400">Items logged</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                  {confirmation.itemCount}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <dt className="text-zinc-500 dark:text-zinc-400">
                  Total Retail Loss
                </dt>
                <dd className="text-lg font-semibold text-red-600 dark:text-red-400">
                  {formatMoney(confirmation.totalRetailLoss)}
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
        <div className="flex-1 space-y-6 px-4 pb-44 pt-6">
          {loadState.status === "loading" && (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Loading waste items…
              </p>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Fetch runs in your browser (not on the server).
              </p>
            </div>
          )}

          {loadState.status === "error" && (
            <div className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
              <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                Could not load waste items
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-red-800 dark:text-red-200">
                {loadState.message}
              </pre>
              <button
                type="button"
                onClick={retryFetch}
                className="w-full rounded-lg border border-red-300 bg-white py-2.5 text-sm font-medium text-red-900 active:bg-red-100 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100 dark:active:bg-red-900/60"
              >
                Retry
              </button>
            </div>
          )}

          {loadState.status === "empty" && (
            <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                No waste items to show
              </p>
              <p className="whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">
                {loadState.message}
              </p>
              <button
                type="button"
                onClick={retryFetch}
                className="w-full rounded-lg border border-amber-400 bg-white py-2.5 text-sm font-medium text-amber-950 active:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100 dark:active:bg-amber-900/70"
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
                    htmlFor="waste-date"
                    className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    Date
                  </label>
                  <input
                    id="waste-date"
                    type="date"
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>

                <div>
                  <span
                    id="shift-label"
                    className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    Shift
                  </span>
                  <div
                    className="mt-1 grid grid-cols-3 gap-2"
                    role="group"
                    aria-labelledby="shift-label"
                  >
                    {["AM", "Mid", "Night"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setShift(s)}
                        className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                          shift === s
                            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                            : "border-zinc-200 bg-white text-zinc-800 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:active:bg-zinc-800"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="submitted-by"
                    className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    Submitted by
                  </label>
                  <input
                    id="submitted-by"
                    type="text"
                    autoComplete="name"
                    placeholder="Employee name"
                    value={submittedBy}
                    onChange={(e) => setSubmittedBy(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500"
                  />
                </div>
              </div>

              {grouped.map(([category, catItems]) => (
                <section key={category} className="space-y-3">
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                    {category}
                  </h2>
                  <ul className="space-y-3">
                    {catItems.map((item) => {
                      const id = item.id;
                      const name =
                        item.item_name ?? item.name ?? "Item";
                      const unit = item.unit_label ?? "";
                      const label =
                        unit && unit.trim()
                          ? `${name} — ${unit}`
                          : name;
                      const qRaw = quantities[id] ?? "";
                      const q = parsePositiveQty(qRaw);
                      const cat = effectiveCategory(item);
                      const isBread = cat === "Bread";

                      let lineRetail = 0;
                      if (!isBread && item.is_dropdown) {
                        const idx = sandwichIdxByItem[id];
                        const opt =
                          typeof idx === "number" && idx >= 0
                            ? SANDWICH_OPTIONS[idx]
                            : null;
                        lineRetail = opt ? q * opt.price : 0;
                      } else if (!isBread) {
                        lineRetail = q * (Number(item.unit_retail_value) || 0);
                      }

                      const lineWholesale = q * (Number(item.unit_wholesale_cost) || 0);

                      return (
                        <li
                          key={id}
                          className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div className="min-w-0 flex-1 space-y-2">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {label}
                              </p>
                              {item.is_dropdown ? (
                                <select
                                  value={
                                    sandwichIdxByItem[id] >= 0
                                      ? String(sandwichIdxByItem[id])
                                      : ""
                                  }
                                  onChange={(e) =>
                                    setSandwichForItem(id, e.target.value)
                                  }
                                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                                  aria-label={`Sandwich type for ${name}`}
                                >
                                  <option value="">Select sandwich…</option>
                                  {SANDWICH_OPTIONS.map((opt, i) => (
                                    <option key={opt.name} value={String(i)}>
                                      {opt.name} — {formatMoney(opt.price)}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                placeholder="Qty"
                                value={qRaw}
                                onChange={(e) => setQty(id, e.target.value)}
                                className="w-full max-w-[8rem] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 tabular-nums focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                                aria-label={`Quantity for ${label}`}
                              />
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="flex flex-wrap items-baseline justify-end gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                <span
                                  className={
                                    isBread
                                      ? "tabular-nums text-lg font-semibold text-orange-600 dark:text-orange-400"
                                      : "tabular-nums text-lg font-semibold text-red-600 dark:text-red-400"
                                  }
                                >
                                  {formatMoney(
                                    isBread ? lineWholesale : lineRetail
                                  )}
                                </span>
                                <span className="normal-case tracking-normal">
                                  {isBread ? "wholesale" : "retail lost"}
                                </span>
                              </p>
                            </div>
                          </div>
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
          <div className="mx-auto w-full max-w-md space-y-1">
            {submitError ? (
              <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {submitError}
              </p>
            ) : null}
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total Retail Loss
              </span>
              <span className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                {formatMoney(totals.retail)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-zinc-500 dark:text-zinc-500">
                Total Wholesale Cost
              </span>
              <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatMoney(totals.wholesale)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs font-medium text-orange-700 dark:text-orange-400/90">
                Bread Waste Cost
              </span>
              <span className="text-sm font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                {formatMoney(totals.breadWholesale)}
              </span>
            </div>
            <button
              type="submit"
              disabled={
                loadState.status !== "ready" || submitting || items.length === 0
              }
              className="mt-4 w-full rounded-lg bg-zinc-900 py-3.5 text-base font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 active:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:active:bg-zinc-200 dark:disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </footer>
    </form>
  );
}
