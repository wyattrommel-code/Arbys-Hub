"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HubClockNav({ kioskUrl }) {
  const pathname = usePathname();
  return <nav aria-label="Time clock" className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 sm:px-4">
    <div className="flex gap-1">{[["attendance","Attendance"],["timecards","Timecards"],["settings","Settings"]].map(([path,label]) => {
      const active = pathname === `/timeclock/${path}`;
      return <Link key={path} href={`/timeclock/${path}`} aria-current={active ? "page" : undefined}
        className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${active ? "bg-[#C8102E] text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{label}</Link>;
    })}</div>
    <Link href={kioskUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-[#C8102E] hover:underline">Open store clock ↗</Link>
  </nav>;
}
