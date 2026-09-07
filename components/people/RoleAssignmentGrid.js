"use client";

import { accessTierLabel, highestAccessTier, isPrivilegedAccessTier } from "@/lib/access-tier";

export default function RoleAssignmentGrid({
  roles = [],
  selectedIds = [],
  primaryRoleId = "",
  onChange,
  actorIsGm = false,
  disabled = false,
}) {
  const selectedSet = new Set(selectedIds);

  function canToggle(role) {
    if (disabled) return false;
    if (!isPrivilegedAccessTier(role.access_tier)) return true;
    return actorIsGm;
  }

  function emit(nextIds, nextPrimary) {
    const unique = [...new Set(nextIds.filter(Boolean))];
    const primary = unique.includes(nextPrimary) ? nextPrimary : unique[0] || "";
    onChange?.({ selectedIds: unique, primaryRoleId: primary });
  }

  function toggle(role) {
    if (!canToggle(role)) return;
    if (selectedSet.has(role.id)) {
      if (selectedIds.length <= 1) return;
      emit(
        selectedIds.filter((id) => id !== role.id),
        primaryRoleId
      );
      return;
    }
    emit([...selectedIds, role.id], primaryRoleId || role.id);
  }

  function selectAllAssignable() {
    const next = roles
      .filter((role) => canToggle(role) || selectedSet.has(role.id))
      .filter((role) => canToggle(role))
      .map((role) => role.id);
    const keepLocked = selectedIds.filter((id) => {
      const role = roles.find((r) => r.id === id);
      return role && !canToggle(role);
    });
    emit([...new Set([...next, ...keepLocked])], primaryRoleId);
  }

  const access = accessTierLabel(highestAccessTier(roles.filter((r) => selectedSet.has(r.id)).map((r) => r.access_tier)));

  return (
    <div className="sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-600">Roles</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            Access: {access}
          </span>
          <button
            type="button"
            onClick={selectAllAssignable}
            disabled={disabled}
            className="text-[11px] font-semibold text-[#C8102E] hover:underline disabled:opacity-50"
          >
            Select All
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {roles.map((role) => {
          const checked = selectedSet.has(role.id);
          const locked = !canToggle(role);
          return (
            <label
              key={role.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                checked
                  ? "border-[#C8102E]/40 bg-[#C8102E]/5"
                  : "border-zinc-200 dark:border-zinc-700"
              } ${locked ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || locked || (checked && selectedIds.length <= 1)}
                onChange={() => toggle(role)}
                className="h-4 w-4 accent-[#C8102E]"
              />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: role.color || "#6b7280" }} />
              <span className="min-w-0 flex-1 truncate">{role.name}</span>
              {checked ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(e) => {
                    e.preventDefault();
                    emit(selectedIds, role.id);
                  }}
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    primaryRoleId === role.id
                      ? "bg-[#C8102E] text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {primaryRoleId === role.id ? "Primary" : "Set primary"}
                </button>
              ) : null}
            </label>
          );
        })}
      </div>
      {!roles.length ? <p className="mt-1 text-xs text-zinc-500">No active roles yet. Add them under the Roles tab.</p> : null}
      <p className="mt-1 text-[11px] text-zinc-500">Everyone keeps at least one role. Primary is the default on the shift modal.</p>
    </div>
  );
}
