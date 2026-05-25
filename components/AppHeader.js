"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SessionBadge from "@/components/SessionBadge";

const PAGE_TITLES = {
  "/": "Home",
  "/login": "Login",
  "/import": "Import",
  "/waste": "Waste Tracker",
  "/inventory": "Inventory",
  "/dashboard": "Dashboard",
  "/schedule": "Schedule & Attendance",
  "/deployment": "Deployment Chart",
  "/people": "People",
  "/roast-beef": "Roast Beef",
  "/roast": "Roast Beef",
  "/checklist": "Checklist",
  "/checklist/manage": "Manage Checklist",
  "/reports/checklist": "Checklist Reports",
};

function titleForPath(pathname) {
  if (!pathname) return "Arby's Ops";
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  return "Arby's Ops";
}

export default function AppHeader() {
  const pathname = usePathname();
  const title = titleForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-[#9e0f25] bg-[#C8102E] text-white shadow-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-3 sm:px-4">
        <div className="min-w-[72px] shrink-0">
          <span className="text-xl font-bold tracking-tight">Arby&apos;s</span>
        </div>

        <h1 className="min-w-0 flex-1 truncate px-1 text-center text-base font-semibold sm:text-lg">
          {title}
        </h1>

        <div className="flex min-w-[72px] shrink-0 items-center justify-end gap-1 sm:gap-2">
          {pathname !== "/login" ? (
            <Link
              href="/reports/checklist"
              className="hidden rounded-lg border border-white/25 bg-white/10 px-2 py-1.5 text-xs font-semibold hover:bg-white/20 sm:inline-flex"
            >
              Reports
            </Link>
          ) : null}
          <SessionBadge />
          {pathname !== "/login" ? (
            <Link
              href="/"
              aria-label="Go to home page"
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-white/25 bg-white/10 px-2 text-xs font-semibold transition-colors hover:bg-white/20 sm:text-sm"
            >
              Home
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
