"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canAccess } from "@/lib/permissions";

const MANAGE_ITEMS = [
  { href: "/schedule/builder", label: "Schedule Builder" },
  { href: "/schedule/stations", label: "Stations" },
  { href: "/schedule/availability", label: "Manage Availability" },
];

const YOUR_ITEMS = [
  { href: "/schedule/me", label: "Shifts" },
  { href: "/schedule/me/availability", label: "Availability" },
  { href: "/schedule/me/time-off", label: "Time Off" },
  { href: "/schedule/attendance", label: "Attendance" },
];

function itemActive(pathname, href) {
  if (href === "/schedule/me") {
    return pathname === "/schedule/me";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroup({ title, items, pathname }) {
  return (
    <div>
      <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = itemActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm ${
                  active
                    ? "bg-[#C8102E] font-semibold text-white"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ScheduleSectionNav({ role }) {
  const pathname = usePathname();
  const canManage = canAccess(role, "schedule.full");

  return (
    <aside
      className="schedule-no-print w-full shrink-0 border-b border-zinc-200 bg-white px-3 py-4 dark:border-zinc-800 dark:bg-zinc-900 md:w-52 md:border-b-0 md:border-r"
      aria-label="Scheduling"
    >
      <p className="mb-4 hidden px-3 text-sm font-bold text-[#C8102E] md:block">Scheduling</p>
      <nav className="flex flex-col gap-5">
        {canManage ? <NavGroup title="Manage" items={MANAGE_ITEMS} pathname={pathname} /> : null}
        <NavGroup title="Your Schedule" items={YOUR_ITEMS} pathname={pathname} />
      </nav>
    </aside>
  );
}
