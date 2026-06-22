"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { normalizeRole } from "@/lib/permissions";
import { getRosterCategory } from "@/lib/employees";

const HUB_ROLE_LABELS = {
  crew: "Crew",
  shift_lead: "Shift Lead",
  gm: "GM",
};

function hubRoleLabel(role) {
  return HUB_ROLE_LABELS[normalizeRole(role)] || "Crew";
}

function hubRoleBadgeClass(role) {
  const normalized = normalizeRole(role);
  if (normalized === "gm") return "bg-purple-100 text-purple-800";
  if (normalized === "shift_lead") return "bg-amber-100 text-amber-900";
  return "bg-zinc-100 text-zinc-700";
}

function SortHeader({ label, column, sortKey, sortDir, onSort, className = "" }) {
  const active = sortKey === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 ${className}`}
    >
      {label}
      {active ? <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}

function StationChips({ stations }) {
  if (!stations.length) {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  const visible = stations.slice(0, 3);
  const extra = stations.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((s) => (
        <span key={s} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {s}
        </span>
      ))}
      {extra > 0 ? (
        <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700">
          +{extra} more
        </span>
      ) : null}
    </div>
  );
}

function MenuAction({ onAction, children, className = "" }) {
  return (
    <button
      type="button"
      className={className}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAction();
      }}
    >
      {children}
    </button>
  );
}

function ActionsMenu({ emp, statusFilter, open, onToggle, onClose, onEdit, onDeactivate, onTerminate, onReactivate, onDelete }) {
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);

  useEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuStyle(null);
      return;
    }
    function positionMenu() {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - 160),
        zIndex: 60,
        minWidth: "10rem",
      });
    }
    positionMenu();
    window.addEventListener("scroll", positionMenu, true);
    window.addEventListener("resize", positionMenu);
    return () => {
      window.removeEventListener("scroll", positionMenu, true);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      const target = e.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, onClose]);

  const category = statusFilter === "all" ? (emp._rosterCategory || "active") : statusFilter;

  const menu = open && menuStyle ? (
    <div
      ref={menuRef}
      style={menuStyle}
      className="rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      role="menu"
    >
      <MenuAction
        className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
        onAction={() => {
          onEdit(emp);
          onClose();
        }}
      >
        Edit
      </MenuAction>
      {category === "active" ? (
        <>
          <MenuAction
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onAction={() => {
              onDeactivate(emp);
              onClose();
            }}
          >
            Deactivate
          </MenuAction>
          <MenuAction
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onAction={() => {
              onTerminate(emp);
              onClose();
            }}
          >
            Terminate
          </MenuAction>
        </>
      ) : null}
      {category === "inactive" ? (
        <>
          <MenuAction
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onAction={() => {
              onReactivate(emp);
              onClose();
            }}
          >
            Reactivate
          </MenuAction>
          <MenuAction
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onAction={() => {
              onTerminate(emp);
              onClose();
            }}
          >
            Terminate
          </MenuAction>
        </>
      ) : null}
      {category === "terminated" ? (
        <MenuAction
          className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          onAction={() => {
            onReactivate(emp);
            onClose();
          }}
        >
          Reactivate
        </MenuAction>
      ) : null}
      <MenuAction
        className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
        onAction={() => {
          onDelete(emp);
          onClose();
        }}
      >
        Delete
      </MenuAction>
    </div>
  ) : null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        aria-label={`Actions for ${emp._displayName}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

export default function RosterTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  revealedPinId,
  onRevealPin,
  menuOpenId,
  setMenuOpenId,
  statusFilter,
  onOpenDetail,
  onEdit,
  onDeactivate,
  onTerminate,
  onReactivate,
  onDelete,
}) {
  if (!rows.length) {
    return <p className="px-4 py-8 text-center text-sm text-zinc-500">No employees match this view.</p>;
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block max-h-[calc(100dvh-18rem)] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr className="h-11">
              <th className="px-3 py-2 text-left">
                <SortHeader label="Name" column="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader label="PIN" column="pin" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader label="Role" column="role" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader label="Stations" column="stations" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHeader label="Last Modified" column="modified" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((emp) => {
              const inactive = getRosterCategory(emp) !== "active";
              return (
              <tr
                key={emp.id}
                className={`h-11 border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50 ${
                  inactive ? "bg-zinc-50/80 opacity-70 dark:bg-zinc-900/40" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onOpenDetail(emp)} className="font-medium text-[#C8102E] hover:underline">
                    {emp._displayName}
                    {emp.is_shift_lead ? " ⭐" : ""}
                    {inactive ? (
                      <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        {getRosterCategory(emp) === "terminated" ? "Terminated" : "Inactive"}
                      </span>
                    ) : null}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onRevealPin(emp.id)}
                    className="font-mono text-xs text-zinc-700 hover:text-zinc-900 dark:text-zinc-300"
                  >
                    {revealedPinId === emp.id ? emp.employee_code || "—" : "****"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${hubRoleBadgeClass(emp.role)}`}>
                    {hubRoleLabel(emp.role)}
                  </span>
                </td>
                <td className="max-w-[12rem] px-3 py-2">
                  <StationChips stations={emp._stations} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{emp._modifiedLabel}</td>
                <td className="relative px-3 py-2 text-right">
                  <ActionsMenu
                    emp={emp}
                    statusFilter={statusFilter}
                    open={menuOpenId === emp.id}
                    onToggle={() => setMenuOpenId((id) => (id === emp.id ? null : emp.id))}
                    onClose={() => setMenuOpenId(null)}
                    onEdit={onEdit}
                    onDeactivate={onDeactivate}
                    onTerminate={onTerminate}
                    onReactivate={onReactivate}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800 md:hidden">
        {rows.map((emp) => {
          const inactive = getRosterCategory(emp) !== "active";
          return (
          <div
            key={emp.id}
            className={`px-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
              inactive ? "bg-zinc-50/80 opacity-70 dark:bg-zinc-900/40" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onOpenDetail(emp)} className="min-w-0 flex-1 text-left">
                <p className="font-medium text-[#C8102E]">
                  {emp._displayName}
                  {emp.is_shift_lead ? " ⭐" : ""}
                  {inactive ? (
                    <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      {getRosterCategory(emp) === "terminated" ? "Terminated" : "Inactive"}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${hubRoleBadgeClass(emp.role)}`}>
                    {hubRoleLabel(emp.role)}
                  </span>
                </p>
              </button>
              <ActionsMenu
                emp={emp}
                statusFilter={statusFilter}
                open={menuOpenId === emp.id}
                onToggle={() => setMenuOpenId((id) => (id === emp.id ? null : emp.id))}
                onClose={() => setMenuOpenId(null)}
                onEdit={onEdit}
                onDeactivate={onDeactivate}
                onTerminate={onTerminate}
                onReactivate={onReactivate}
                onDelete={onDelete}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StationChips stations={emp._stations} />
              <span className="text-[10px] text-zinc-500">{emp._modifiedLabel}</span>
            </div>
          </div>
          );
        })}
      </div>
    </>
  );
}
