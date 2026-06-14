"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  Flame,
  Home,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { SIDEBAR_NAV, isNavActive } from "@/lib/nav";

const ICONS = {
  home: Home,
  "clipboard-list": ClipboardList,
  flame: Flame,
  "trash-2": Trash2,
  upload: Upload,
  "bar-chart-3": BarChart3,
  settings: Settings,
};

function NavLinks({ onNavigate }) {
  const pathname = usePathname();

  return (
    <ul className="space-y-1">
      {SIDEBAR_NAV.map((item) => {
        const active = isNavActive(pathname, item);
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "border-l-4 border-white bg-white/15 pl-[calc(0.75rem-4px)]"
                  : "border-l-4 border-transparent text-white/90 hover:bg-white/10 hover:text-white"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {Icon ? <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function Sidebar({ mobileOpen, onClose }) {
  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-50 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={onClose}
        />
      ) : null}

      {/* Desktop — fixed full viewport height, stays visible while main scrolls */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden h-dvh w-60 flex-col bg-[#9e0f25] text-white md:flex"
        aria-label="Sidebar"
      >
        <div className="flex h-16 shrink-0 items-center border-b border-white/10 px-5">
          <span className="text-xl font-bold tracking-tight">Arby&apos;s</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          <NavLinks />
        </nav>
      </aside>

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-[60] flex h-dvh w-60 flex-col bg-[#9e0f25] text-white shadow-xl transition-transform duration-200 ease-out md:hidden ${
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
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-white/10"
            aria-label="Close menu"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          <NavLinks onNavigate={onClose} />
        </nav>
      </aside>
    </>
  );
}
