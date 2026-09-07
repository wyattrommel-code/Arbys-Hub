"use client";

import { useEffect, useState } from "react";

const DEFAULTS = {
  grace_minutes_late: 10,
  grace_minutes_early_in: 10,
  grace_minutes_early_out: 10,
  require_face_on_clock_in: true,
  require_photo_on_clock_out: false,
  subtract_scheduled_break: true,
};

export default function AttendanceSettings() {
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/attendance/settings")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) throw new Error(data.error || "Could not load settings.");
        setForm({ ...DEFAULTS, ...data.settings });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/attendance/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save.");
      setForm({ ...DEFAULTS, ...data.settings });
      setMessage("Saved. New punches use these thresholds. Re-scan Attendance to apply them to past days.");
    } catch (err) {
      setError(err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  function num(field) {
    return (
      <input
        type="number"
        min="0"
        max="180"
        step="1"
        value={form[field]}
        onChange={(e) => setForm((s) => ({ ...s, [field]: Number(e.target.value) }))}
        className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
    );
  }

  function toggle(field, label, hint) {
    return (
      <label className="flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-3 text-sm dark:border-zinc-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={Boolean(form[field])}
          onChange={(e) => setForm((s) => ({ ...s, [field]: e.target.checked }))}
        />
        <span>
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
          <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>
        </span>
      </label>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading attendance settings…</p>;
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Attendance</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Grace windows before a red flag fires. Saving does not rewrite past flags until you re-scan.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-zinc-600">
          Late grace (min)
          {num("grace_minutes_late")}
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Early-in grace (min)
          {num("grace_minutes_early_in")}
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Early-out grace (min)
          {num("grace_minutes_early_out")}
        </label>
      </div>

      <div className="space-y-2">
        {toggle("require_face_on_clock_in", "Require face on clock-in", "Time clock waits for a detected face before capturing.")}
        {toggle("require_photo_on_clock_out", "Require photo on clock-out", "Off by default. Same face-present capture when enabled.")}
        {toggle(
          "subtract_scheduled_break",
          "Subtract scheduled break from worked time",
          "Payroll uses exact punch times minus the shift’s unpaid break."
        )}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save attendance settings"}
      </button>
    </form>
  );
}
