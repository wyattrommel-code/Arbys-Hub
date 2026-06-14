"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import SessionBadge from "@/components/SessionBadge";
import { titleForPath } from "@/lib/nav";

export default function AppHeader({ onMenuToggle, menuOpen = false }) {
  const pathname = usePathname();
  const title = titleForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-[#9e0f25] bg-[#C8102E] text-white shadow-md">
      <div className="flex h-16 w-full items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-[44px] shrink-0 items-center md:min-w-0">
          <button
            type="button"
            onClick={onMenuToggle}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/25 bg-white/10 transition-colors hover:bg-white/20 md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <h1 className="min-w-0 flex-1 truncate px-1 text-center text-base font-semibold sm:text-lg">
          {title}
        </h1>

        <div className="flex min-w-[44px] shrink-0 items-center justify-end md:min-w-[120px]">
          <SessionBadge />
        </div>
      </div>
    </header>
  );
}
