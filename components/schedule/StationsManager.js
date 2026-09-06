"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import { SCHEDULE_STORE_ID } from "@/lib/schedule";
import { getSupabase } from "@/lib/supabase";

const DEFAULT_COLOR = "#C8102E";

export default function StationsManager() {
  const supabase = useMemo(() => getSupabase(), []);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ name: "", color: DEFAULT_COLOR, sort_order: 0 });
  const [editingId, setEditingId] = useState(null);

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stations")
      .select("*")
      .eq("store_id", SCHEDULE_STORE_ID)
      .order("sort_order", { ascending: true });
    if (error) {
      const fallback = await supabase.from("stations").select("*").order("sort_order", { ascending: true });
      if (fallback.error) {
        showToast(error.message || "Could not load stations.");
        setStations([]);
      } else {
        setStations(fallback.data || []);
      }
    } else {
      setStations(data || []);
    }
    setLoading(false);
  }, [showToast, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveStation(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const payload = {
      name,
      color: form.color || DEFAULT_COLOR,
      sort_order: Number(form.sort_order) || 0,
      is_active: true,
      store_id: SCHEDULE_STORE_ID,
    };
    const query = editingId
      ? supabase.from("stations").update(payload).eq("id", editingId)
      : supabase.from("stations").insert(payload);
    const { error } = await query;
    if (error) {
      showToast(error.message || "Could not save station.");
      return;
    }
    setForm({ name: "", color: DEFAULT_COLOR, sort_order: (stations.length + 1) * 10 });
    setEditingId(null);
    showToast("Station saved.", "success");
    load();
  }

  async function toggleActive(station) {
    const { error } = await supabase
      .from("stations")
      .update({ is_active: !station.is_active })
      .eq("id", station.id);
    if (error) {
      showToast(error.message || "Could not update station.");
      return;
    }
    load();
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-xl font-semibold">Stations</h2>
        <p className="text-sm text-zinc-500">These feed the Stations field when creating a shift.</p>
      </div>

      <form
        onSubmit={saveStation}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <p className="text-sm font-bold text-[#C8102E]">{editingId ? "Edit station" : "Add station"}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            required
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="Name"
            className="rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm((s) => ({ ...s, color: e.target.value }))}
            className="h-10 w-16 rounded border border-zinc-200"
          />
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) => setForm((s) => ({ ...s, sort_order: e.target.value }))}
            className="w-24 rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" className="rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white">
            {editingId ? "Update" : "Add"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm({ name: "", color: DEFAULT_COLOR, sort_order: 0 });
              }}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading stations…</p>
      ) : (
        <ul className="space-y-2">
          {stations.map((station) => (
            <li
              key={station.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 rounded" style={{ background: station.color || DEFAULT_COLOR }} />
                <div>
                  <p className="font-semibold">{station.name}</p>
                  <p className="text-xs text-zinc-500">
                    Order {station.sort_order} · {station.is_active ? "Active" : "Inactive"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(station.id);
                    setForm({
                      name: station.name,
                      color: station.color || DEFAULT_COLOR,
                      sort_order: station.sort_order || 0,
                    });
                  }}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(station)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold"
                >
                  {station.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ScheduleToast toast={toast} />
    </section>
  );
}
