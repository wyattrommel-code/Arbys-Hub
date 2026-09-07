"use client";

import { useMemo, useState } from "react";
import { ACCESS_TIER_OPTIONS, accessTierLabel, isPrivilegedAccessTier } from "@/lib/access-tier";

const DEFAULT_FORM = {
  name: "",
  color: "#6b7280",
  sort_order: "",
  access_tier: "none",
};

export default function RolesAdmin({ roles = [], onChanged, actorIsGm = false }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sorted = useMemo(
    () =>
      [...roles].sort((a, b) => {
        const order = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
        if (order !== 0) return order;
        return String(a.name).localeCompare(String(b.name));
      }),
    [roles]
  );

  function startEdit(role) {
    setEditingId(role.id);
    setForm({
      name: role.name || "",
      color: role.color || "#6b7280",
      sort_order: role.sort_order ?? "",
      access_tier: role.access_tier || "none",
    });
    setError("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError("");
  }

  async function save() {
    const name = form.name.trim();
    if (!name) {
      setError("Role name is required.");
      return;
    }
    if (isPrivilegedAccessTier(form.access_tier) && !actorIsGm) {
      setError("Only a GM can set an access level above None.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name,
        color: form.color,
        sort_order: form.sort_order === "" ? undefined : Number(form.sort_order),
        access_tier: form.access_tier || "none",
      };
      const res = await fetch(editingId ? `/api/roles/${editingId}` : "/api/roles", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save role.");
      resetForm();
      await onChanged?.();
    } catch (err) {
      setError(err.message || "Could not save role.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(role, isActive) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update role.");
      await onChanged?.();
    } catch (err) {
      setError(err.message || "Could not update role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {editingId ? "Edit role" : "Add role"}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          This is the managed list used for scheduling and access. Deactivate instead of deleting so history stays intact.
        </p>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-zinc-600">
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">
            Color
            <input
              type="color"
              value={form.color || "#6b7280"}
              onChange={(e) => setForm((s) => ({ ...s, color: e.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">
            Sort order
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((s) => ({ ...s, sort_order: e.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-xs font-medium text-zinc-600">
            Access tier
            <select
              value={form.access_tier}
              onChange={(e) => setForm((s) => ({ ...s, access_tier: e.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {ACCESS_TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={!actorIsGm && opt.value !== "none" && opt.value !== form.access_tier}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="h-10 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {editingId ? "Save role" : "Add role"}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-semibold">
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">Role</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">Access</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">Order</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((role) => (
              <tr key={role.id} className={`border-b border-zinc-100 dark:border-zinc-800 ${role.is_active ? "" : "opacity-60"}`}>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color || "#6b7280" }} />
                    {role.name}
                    {!role.is_active ? (
                      <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600">Inactive</span>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {ACCESS_TIER_OPTIONS.find((o) => o.value === role.access_tier)?.label || accessTierLabel(role.access_tier)}
                </td>
                <td className="px-3 py-2 text-zinc-600">{role.sort_order}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => startEdit(role)} className="text-xs font-semibold text-[#C8102E] hover:underline">
                      Edit
                    </button>
                    {role.is_active ? (
                      <button type="button" onClick={() => setActive(role, false)} disabled={busy} className="text-xs font-semibold text-zinc-600 hover:underline">
                        Deactivate
                      </button>
                    ) : (
                      <button type="button" onClick={() => setActive(role, true)} disabled={busy} className="text-xs font-semibold text-zinc-600 hover:underline">
                        Reactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
