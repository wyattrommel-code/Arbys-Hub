"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGE_TITLES = {
  "/": "Home",
  "/import": "Import",
  "/waste": "Waste Tracker",
  "/inventory": "Inventory",
  "/dashboard": "Dashboard",
  "/roast-beef": "Roast Beef",
  "/roast": "Roast Beef",
};

function titleForPath(pathname) {
  if (!pathname) return "Arby's Ops";
  return PAGE_TITLES[pathname] ?? "Arby's Ops";
}

export default function AppHeader() {
  const pathname = usePathname();
  const title = titleForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-[#9e0f25] bg-[#C8102E] text-white shadow-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-3 sm:px-4">
        <div className="min-w-[80px]">
          <span className="text-xl font-bold tracking-tight">Arby&apos;s</span>
        </div>

        <h1 className="truncate px-2 text-center text-base font-semibold sm:text-lg">
          {title}
        </h1>

        <Link
          href="/"
          aria-label="Go to home page"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/25 bg-white/10 px-2 text-sm font-semibold transition-colors hover:bg-white/20"
        >
          Home
        </Link>
      </div>
    </header>
  );
}
