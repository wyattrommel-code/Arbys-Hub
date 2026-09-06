"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import { DAY_LABELS, fromTimeInput, timeInputValue } from "@/lib/schedule";
import { getSupabase } from "@/lib/supabase";

const EMPTY_AVAIL = DAY_LABELS.map((_, day) => ({
  day_of_week: day,
  is_available: true,
  available_start: "",
  available_end: "",
}));

export default function MyAvailability({ employee }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [availability, setAvailability] = useState(EMPTY_AVAIL);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const fullName = `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    if (!employee?.employee_id) return;
    const { data, error } = await supabase
      .from("employee_availability")
      .select("*")
      .eq("employee_id", employee.employee_id);
    if (error) {
      showToast(error.message || "Could not load availability.");
      return;
    }
    setAvailability(
      EMPTY_AVAIL.map((day) => {
        const existing = (data || []).find((row) => Number(row.day_of_week) === day.day_of_week);
        if (!existing) return day;
        return {
          day_of_week: day.day_of_week,
          is_available: existing.is_available !== false,
          available_start: existing.available_start || "",
          available_end: existing.available_end || "",
          id: existing.id,
        };
      })
    );
  }, [employee, showToast, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const rows = availability.map((day) => ({
        employee_id: employee.employee_id,
        employee_name: fullName,
        day_of_week: day.day_of_week,
        is_available: day.is_available,
        available_start: day.is_available ? day.available_start || null : null,
        available_end: day.is_available ? day.available_end || null : null,
      }));
      const { error } = await supabase
        .from("employee_availability")
        .upsert(rows, { onConflict: "employee_id,day_of_week" });
      if (error) throw error;
      showToast("Availability saved.", "success");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not save availability.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-xl font-semibold">My availability</h2>
        <p className="text-sm text-zinc-500">
          Managers use this as a warning only — it does not block scheduling.
        </p>
      </div>
      <form
        onSubmit={save}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-2">
          {availability.map((day) => (
            <div
              key={day.day_of_week}
              className="grid grid-cols-[72px_1fr] items-center gap-2 sm:grid-cols-[72px_auto_1fr_1fr]"
            >
              <span className="text-sm font-semibold">{DAY_LABELS[day.day_of_week]}</span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={day.is_available}
                  onChange={(e) =>
                    setAvailability((current) =>
                      current.map((row) =>
                        row.day_of_week === day.day_of_week ? { ...row, is_available: e.target.checked } : row
                      )
                    )
                  }
                />
                Available
              </label>
              <input
                type="time"
                disabled={!day.is_available}
                value={timeInputValue(day.available_start)}
                onChange={(e) =>
                  setAvailability((current) =>
                    current.map((row) =>
                      row.day_of_week === day.day_of_week
                        ? { ...row, available_start: fromTimeInput(e.target.value) || row.available_start }
                        : row
                    )
                  )
                }
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <input
                type="time"
                disabled={!day.is_available}
                value={timeInputValue(day.available_end)}
                onChange={(e) =>
                  setAvailability((current) =>
                    current.map((row) =>
                      row.day_of_week === day.day_of_week
                        ? { ...row, available_end: fromTimeInput(e.target.value) || row.available_end }
                        : row
                    )
                  )
                }
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
          ))}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save availability"}
        </button>
      </form>
      <ScheduleToast toast={toast} />
    </section>
  );
}
