import Link from "next/link";

const navCards = [
  {
    href: "/import",
    title: "Import",
    description: "Upload labor and hourly sales CSV files.",
  },
  {
    href: "/waste",
    title: "Waste Tracker",
    description: "Log food waste with shift and retail-loss totals.",
  },
  {
    href: "/roast-beef",
    title: "Roast Beef",
    description: "Open the daily roast beef sheet and forecast view.",
  },
  {
    href: "/inventory",
    title: "Inventory",
    description: "Inventory tools placeholder page.",
  },
  {
    href: "/dashboard",
    title: "Dashboard",
    description: "GM dashboard placeholder page.",
  },
  {
    href: "/schedule",
    title: "Schedule & Attendance",
    description:
      "Compare scheduled vs actual shifts, track attendance patterns and flags.",
  },
  {
    href: "/deployment",
    title: "Deployment Chart",
    description:
      "Enter station assignments for each shift. Morning by 10:30am, Night by 4:30pm.",
  },
];

export default function Home() {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
      <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
        Choose a section to open.
      </p>

      <nav
        className="grid gap-3 sm:grid-cols-2"
        aria-label="Operations sections"
      >
        {navCards.map(({ href, title, description }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-[#C8102E]/20 bg-white p-4 shadow-sm transition hover:border-[#C8102E] hover:shadow-md active:translate-y-px dark:bg-zinc-900"
          >
            <p className="text-lg font-semibold text-[#C8102E]">{title}</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {description}
            </p>
            <p className="mt-3 text-sm font-medium text-zinc-700 group-hover:text-[#C8102E] dark:text-zinc-300">
              Open section →
            </p>
          </Link>
        ))}
      </nav>
    </section>
  );
}
