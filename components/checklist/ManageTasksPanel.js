"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CHECKLIST_ROLE_LABELS,
  CHECKLIST_ROLE_ORDER,
  DAY_OF_WEEK_OPTIONS,
  SHIFT_OPTIONS,
  VERIFICATION_METHOD_OPTIONS,
} from "@/lib/constants";

function emptyTask(role = "any") {
  return {
    title: "",
    description: "",
    day_of_week: "",
    shift: "BOTH",
    role,
    verification_method: "checkbox",
    display_order: 0,
    is_active: true,
  };
}

function methodIcon(method) {
  switch (method) {
    case "photo":
    case "photo_ai":
      return "📷";
    case "signature":
      return "✍";
    case "yes_no":
    case "yes/no":
      return "Y/N";
    case "checkbox":
    default:
      return "✓";
  }
}

function SortableTaskRow({ task, onOpenSettings }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const inactive = task.is_active === false;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border-b border-zinc-100 px-2 py-2 last:border-0 dark:border-zinc-800 ${
        isDragging ? "relative z-10 bg-zinc-50 shadow-md dark:bg-zinc-800" : ""
      } ${inactive ? "opacity-45" : ""}`}
    >
      <button
        type="button"
        className="touch-none shrink-0 cursor-grab px-1 text-lg leading-none text-zinc-400 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-xs dark:border-zinc-700"
        aria-hidden="true"
      >
        {methodIcon(task.verification_method)}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {task.title || "Untitled task"}
      </p>
      <button
        type="button"
        onClick={() => onOpenSettings(task)}
        className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label={`Settings for ${task.title || "task"}`}
      >
        ⋮
      </button>
    </li>
  );
}

function TaskSettingsPanel({ draft, saving, onChange, onSave, onClose, onDeactivate }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[90vh] w-full flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-xl sm:max-w-md sm:rounded-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Task settings</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-zinc-500">Title</span>
            <input
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.title || ""}
              onChange={(e) => onChange("title", e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-zinc-500">Description</span>
            <input
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.description || ""}
              onChange={(e) => onChange("description", e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-zinc-500">Day</span>
            <select
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.day_of_week == null ? "" : String(draft.day_of_week)}
              onChange={(e) => onChange("day_of_week", e.target.value === "" ? null : e.target.value)}
            >
              {DAY_OF_WEEK_OPTIONS.map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-zinc-500">Shift</span>
            <select
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.shift || "BOTH"}
              onChange={(e) => onChange("shift", e.target.value)}
            >
              {SHIFT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-zinc-500">Verification method</span>
            <select
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.verification_method || "checkbox"}
              onChange={(e) => onChange("verification_method", e.target.value)}
            >
              {VERIFICATION_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <span className="text-sm font-medium">Active</span>
            <input
              type="checkbox"
              checked={draft.is_active !== false}
              onChange={(e) => onChange("is_active", e.target.checked)}
            />
          </label>
          <button
            type="button"
            onClick={onDeactivate}
            className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            Delete task
          </button>
        </div>
        <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button
            type="button"
            disabled={saving || !String(draft.title || "").trim()}
            onClick={onSave}
            className="w-full rounded-lg bg-[#C8102E] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManageTasksPanel() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(emptyTask());
  const [savingId, setSavingId] = useState(null);
  const [selectedRole, setSelectedRole] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/checklist/tasks?mode=manage");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to load tasks");
      return;
    }
    setTasks(json.tasks || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveTask(id, updates) {
    setSavingId(id || "new");
    setError("");
    try {
      const res = await fetch("/api/checklist/tasks", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id, ...updates } : updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      if (!id) setDraft(emptyTask(selectedRole || "any"));
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function updateLocal(id, field, value) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  }

  function openChecklist(role) {
    setSelectedRole(role);
    setDraft(emptyTask(role));
    setSettingsDraft(null);
    setShowAdd(false);
  }

  function backToList() {
    setSelectedRole(null);
    setDraft(emptyTask());
    setSettingsDraft(null);
    setShowAdd(false);
  }

  const roleCounts = useMemo(() => {
    const counts = Object.fromEntries(CHECKLIST_ROLE_ORDER.map((role) => [role, 0]));
    for (const task of tasks) {
      const role = task.role || "any";
      if (role in counts) counts[role] += 1;
    }
    return counts;
  }, [tasks]);

  const detailTasks = useMemo(() => {
    if (!selectedRole) return [];
    return tasks
      .filter((task) => (task.role || "any") === selectedRole)
      .slice()
      .sort((a, b) => {
        const orderDiff = (a.display_order ?? 0) - (b.display_order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.title || "").localeCompare(String(b.title || ""));
      });
  }, [tasks, selectedRole]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  async function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = detailTasks.findIndex((t) => t.id === active.id);
    const newIndex = detailTasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previousOrders = Object.fromEntries(
      detailTasks.map((t) => [t.id, t.display_order ?? 0])
    );
    const reordered = arrayMove(detailTasks, oldIndex, newIndex).map((task, index) => ({
      ...task,
      display_order: (index + 1) * 10,
    }));
    const byId = Object.fromEntries(reordered.map((t) => [t.id, t]));

    setTasks((prev) => prev.map((t) => byId[t.id] || t));

    const changed = reordered.filter((t) => previousOrders[t.id] !== t.display_order);
    if (changed.length === 0) return;

    setSavingId("reorder");
    setError("");
    try {
      await Promise.all(
        changed.map(async (task) => {
          const res = await fetch("/api/checklist/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: task.id, display_order: task.display_order }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Reorder failed");
        })
      );
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft?.id) return;
    const ok = await saveTask(settingsDraft.id, settingsDraft);
    if (ok) setSettingsDraft(null);
  }

  async function handleDeactivate() {
    if (!settingsDraft?.id) return;
    // No DELETE endpoint on /api/checklist/tasks — soft-delete by deactivating.
    const next = { ...settingsDraft, is_active: false };
    setSettingsDraft(next);
    updateLocal(settingsDraft.id, "is_active", false);
    const ok = await saveTask(settingsDraft.id, { ...settingsDraft, is_active: false });
    if (ok) setSettingsDraft(null);
  }

  async function handleAddTask() {
    if (!selectedRole || !draft.title.trim()) return;
    const maxOrder = detailTasks.reduce((max, t) => Math.max(max, t.display_order ?? 0), 0);
    const payload = {
      ...draft,
      role: selectedRole,
      display_order: maxOrder > 0 ? maxOrder + 10 : 10,
    };
    const ok = await saveTask(null, payload);
    if (ok) setShowAdd(false);
  }

  if (selectedRole === null) {
    return (
      <div className="space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {CHECKLIST_ROLE_ORDER.map((role) => {
            const count = roleCounts[role] ?? 0;
            return (
              <button
                key={role}
                type="button"
                onClick={() => openChecklist(role)}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-[#C8102E]/40 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="text-base font-semibold text-[#C8102E]">
                  {CHECKLIST_ROLE_LABELS[role] || role}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  {count} {count === 1 ? "item" : "items"}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <button
            type="button"
            onClick={backToList}
            className="text-sm font-semibold text-[#C8102E] hover:underline"
          >
            ← All checklists
          </button>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {CHECKLIST_ROLE_LABELS[selectedRole] || selectedRole}
          </h2>
          <p className="text-sm text-zinc-500">
            {detailTasks.length} {detailTasks.length === 1 ? "item" : "items"}
            {savingId === "reorder" ? " · Saving order…" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(emptyTask(selectedRole));
            setShowAdd((v) => !v);
          }}
          className="rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white"
        >
          {showAdd ? "Cancel" : "Add task"}
        </button>
      </div>

      {showAdd ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Title"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
            <select
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={draft.verification_method}
              onChange={(e) => setDraft((d) => ({ ...d, verification_method: e.target.value }))}
            >
              {VERIFICATION_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!draft.title.trim() || savingId === "new"}
            onClick={handleAddTask}
            className="mt-3 rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {savingId === "new" ? "Adding…" : "Add task"}
          </button>
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {detailTasks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No tasks in this checklist yet. Add one above.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={detailTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {detailTasks.map((task) => (
                  <SortableTaskRow
                    key={task.id}
                    task={task}
                    onOpenSettings={(t) => setSettingsDraft({ ...t })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {settingsDraft ? (
        <TaskSettingsPanel
          draft={settingsDraft}
          saving={savingId === settingsDraft.id}
          onChange={(field, value) => {
            setSettingsDraft((d) => ({ ...d, [field]: value }));
            updateLocal(settingsDraft.id, field, value);
          }}
          onSave={handleSaveSettings}
          onClose={() => {
            load();
            setSettingsDraft(null);
          }}
          onDeactivate={handleDeactivate}
        />
      ) : null}
    </div>
  );
}
