"use client";

import Link from "next/link";

export default function ScheduleSubnav({ current, canBuild = false }) {
  const items = [
    { id: "attendance", href: "/schedule", label: "Attendance" },
    canBuild ? { id: "builder", href: "/schedule/builder", label: "Builder" } : null,
    { id: "me", href: "/schedule/me", label: "My Schedule" },
  ].filter(Boolean);

  return (
    <nav
      className="schedule-no-print flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      aria-label="Schedule sections"
    >
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            current === item.id
              ? "bg-[#C8102E] text-white"
              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
