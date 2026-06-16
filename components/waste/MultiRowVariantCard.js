"use client";

import { Plus, Trash2 } from "lucide-react";
import { createSandwichRow } from "@/lib/waste-variants";

function parsePositiveQty(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export default function MultiRowVariantCard({
  title,
  subtitle,
  rows,
  onRowsChange,
  options,
  optionLabel = "Select…",
  formatOption,
  rowRetail,
  formatMoney,
  isBread = false,
  variantKey = "optionIdx",
  placeholderQty = "Qty",
  addButtonLabel = "Add another",
}) {
  const totalRetail = rows.reduce((sum, row) => sum + rowRetail(row), 0);

  function updateRow(rowId, patch) {
    onRowsChange(rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    onRowsChange([...rows, createSandwichRow()]);
  }

  function removeOrClearRow(rowId) {
    if (rows.length <= 1) {
      onRowsChange([createSandwichRow()]);
      return;
    }
    onRowsChange(rows.filter((r) => r.rowId !== rowId));
  }

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
        {subtitle ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p> : null}
      </div>

      <ul className="space-y-3">
        {rows.map((row) => {
          const q = parsePositiveQty(row.qty);
          const lineAmount = rowRetail(row);
          const selectValue =
            variantKey === "sideItemId"
              ? row.sideItemId || ""
              : row.optionIdx >= 0
                ? String(row.optionIdx)
                : "";

          return (
            <li
              key={row.rowId}
              className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-3 transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-950/50"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-2">
                  <select
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (variantKey === "sideItemId") {
                        updateRow(row.rowId, { sideItemId: v });
                      } else {
                        updateRow(row.rowId, { optionIdx: v === "" ? -1 : Number(v) });
                      }
                    }}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    aria-label={`${optionLabel} for ${title}`}
                  >
                    <option value="">{optionLabel}</option>
                    {options.map((opt, i) => (
                      <option
                        key={opt.key ?? opt.name ?? i}
                        value={variantKey === "sideItemId" ? opt.key : String(i)}
                      >
                        {formatOption(opt)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder={placeholderQty}
                    value={row.qty}
                    onChange={(e) => updateRow(row.rowId, { qty: e.target.value })}
                    className="w-full max-w-[8rem] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base tabular-nums text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    aria-label={`Quantity for ${title}`}
                  />
                </div>
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                  <p className="text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    <span
                      className={
                        isBread
                          ? "tabular-nums text-base font-semibold text-orange-600 dark:text-orange-400"
                          : "tabular-nums text-base font-semibold text-red-600 dark:text-red-400"
                      }
                    >
                      {formatMoney(lineAmount)}
                    </span>
                    <span className="ml-1 normal-case">{isBread ? "wholesale" : q > 0 ? "retail lost" : ""}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => removeOrClearRow(row.rowId)}
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label={rows.length <= 1 ? "Clear row" : "Remove row"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
      >
        <Plus className="h-4 w-4" />
        {addButtonLabel}
      </button>

      <div className="mt-3 flex justify-end border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Card total:{" "}
          <span
            className={
              isBread
                ? "tabular-nums text-sm font-semibold text-orange-600 dark:text-orange-400"
                : "tabular-nums text-sm font-semibold text-red-600 dark:text-red-400"
            }
          >
            {formatMoney(totalRetail)}
          </span>
          <span className="ml-1">{isBread ? "wholesale" : "retail lost"}</span>
        </p>
      </div>
    </li>
  );
}
