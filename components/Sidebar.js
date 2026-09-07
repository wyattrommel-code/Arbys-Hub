"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Clock,
  Flame,
  Gauge,
  Home,
  LayoutGrid,
  Package,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  isNavActive,
  isScheduleChildActive,
  SIDEBAR_NAV,
  subnavStorageKey,
} from "@/lib/nav";
import { canAccess } from "@/lib/permissions";

const ICONS = {
  home: Home,
  "clipboard-list": ClipboardList,
  flame: Flame,
  "trash-2": Trash2,
  package: Package,
  users: Users,
  calendar: Calendar,
  clock: Clock,
  "layout-grid": LayoutGrid,
  gauge: Gauge,
  upload: Upload,
  "bar-chart-3": BarChart3,
  settings: Settings,
};

function navClass(active, collapsed) {
  return `flex min-h-11 items-center rounded-lg py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
    collapsed ? "justify-center px-0" : "gap-3 px-3"
  } ${
    active
      ? collapsed
        ? "bg-white/15 text-white"
        : "border-l-4 border-white bg-white/15 pl-[calc(0.75rem-4px)]"
      : collapsed
        ? "text-white/90 hover:bg-white/10 hover:text-white"
        : "border-l-4 border-transparent text-white/90 hover:bg-white/10 hover:text-white"
  }`;
}

function NavGroups({ groups, role, pathname, onNavigate }) {
  return (
    <div className="mb-1 ml-4 mt-1 space-y-3 border-l border-white/20 pl-2">
      {groups.map((group) => {
        if (!canAccess(role, group.feature)) return null;
        return (
          <div key={group.title}>
            <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/50">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((child) => {
                const childActive = isScheduleChildActive(pathname, child.href);
                return (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      className={`block rounded-lg px-2 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                        childActive
                          ? "bg-white font-semibold text-[#C8102E]"
                          : "text-white/85 hover:bg-white/10 hover:text-white"
                      }`}
                      aria-current={childActive ? "page" : undefined}
                    >
                      {child.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function NavLinks({ role, onNavigate, collapsed, openByHref, onToggleGroup, subnavId }) {
  const pathname = usePathname();
  const visibleItems = SIDEBAR_NAV.filter((item) => canAccess(role, item.feature));

  return (
    <ul className="space-y-1">
      {visibleItems.map((item) => {
        const active = isNavActive(pathname, item);
        const Icon = ICONS[item.icon];
        const hasGroups = Array.isArray(item.groups) && item.groups.length > 0;
        const groupOpen = Boolean(openByHref[item.href]);
        const groupId = `${subnavId}-${item.href.replace(/\W+/g, "-")}`;

        return (
          <li key={item.href}>
            <div className={`flex items-center ${collapsed ? "justify-center" : ""}`}>
              <Link
                href={item.href}
                onClick={() => {
                  if (hasGroups && !collapsed) {
                    onToggleGroup(item.href, true);
                  }
                  onNavigate?.();
                }}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`min-w-0 flex-1 ${navClass(active, collapsed)}`}
                aria-current={active && !hasGroups ? "page" : undefined}
              >
                {Icon ? <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
                {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
              </Link>
              {hasGroups && !collapsed ? (
                <button
                  type="button"
                  onClick={() => onToggleGroup(item.href)}
                  className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  aria-label={groupOpen ? `Collapse ${item.label} menu` : `Expand ${item.label} menu`}
                  aria-expanded={groupOpen}
                  aria-controls={groupId}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${
                      groupOpen ? "rotate-0" : "-rotate-90"
                    }`}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
            {hasGroups && !collapsed ? (
              <div
                id={groupId}
                className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
                  groupOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
                aria-hidden={!groupOpen}
                inert={!groupOpen ? true : undefined}
              >
                <div className="overflow-hidden">
                  <NavGroups
                    groups={item.groups}
                    role={role}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function Sidebar({
  mobileOpen,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}) {
  const pathname = usePathname();
  const subnavId = useId();
  const [role, setRole] = useState("crew");
  const [openByHref, setOpenByHref] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.employee?.role) {
          setRole(json.employee.role);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const next = {};
    for (const item of SIDEBAR_NAV) {
      if (!Array.isArray(item.groups) || !item.groups.length) continue;
      const stored = window.localStorage.getItem(subnavStorageKey(item.href));
      if (stored === "0") {
        next[item.href] = false;
      } else if (stored === "1") {
        next[item.href] = true;
      } else {
        next[item.href] = pathname === item.href || pathname.startsWith(`${item.href}/`);
      }
    }
    setOpenByHref(next);
  }, [pathname]);

  function toggleGroup(href, nextValue) {
    setOpenByHref((current) => {
      const nextOpen = typeof nextValue === "boolean" ? nextValue : !current[href];
      window.localStorage.setItem(subnavStorageKey(href), nextOpen ? "1" : "0");
      return { ...current, [href]: nextOpen };
    });
  }

  const railWidth = collapsed ? "w-16" : "w-60";

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-50 bg-black/50 print:hidden md:hidden"
          aria-label="Close menu"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden h-dvh flex-col overflow-x-hidden bg-[#9e0f25] text-white transition-[width] duration-200 ease-out motion-reduce:transition-none print:hidden md:flex ${railWidth}`}
        aria-label="Sidebar"
      >
        <div className={`flex h-16 shrink-0 items-center border-b border-white/10 ${collapsed ? "justify-center px-1" : "justify-between px-3"}`}>
          {collapsed ? null : (
            <span className="truncate text-xl font-bold tracking-tight">Arby&apos;s</span>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronsRight className="h-5 w-5" aria-hidden="true" />
            ) : (
              <ChevronsLeft className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
        <nav className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-1.5" : "px-3"}`} aria-label="Main navigation">
          <NavLinks
            role={role}
            collapsed={collapsed}
            openByHref={openByHref}
            onToggleGroup={toggleGroup}
            subnavId={subnavId}
          />
        </nav>
      </aside>

      <aside
        className={`fixed inset-y-0 left-0 z-[60] flex h-dvh w-60 flex-col bg-[#9e0f25] text-white shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none print:hidden md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
        }`}
        aria-label="Mobile sidebar"
        aria-hidden={!mobileOpen}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <span className="text-xl font-bold tracking-tight">Arby&apos;s</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Close menu"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          <NavLinks
            role={role}
            collapsed={false}
            openByHref={openByHref}
            onToggleGroup={toggleGroup}
            onNavigate={onClose}
            subnavId={`${subnavId}-mobile`}
          />
        </nav>
      </aside>
    </>
  );
}
