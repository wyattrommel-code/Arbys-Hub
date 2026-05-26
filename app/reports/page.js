import Link from "next/link";

export const metadata = {
  title: "Reports | Arby's Ops",
  description: "Store reports and history",
};

export default function ReportsPage() {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Reports</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Choose a report. More sections can be added here over time.
      </p>

      <nav
        className="mt-6 grid gap-3 sm:grid-cols-2"
        aria-label="Report types"
      >
        <Link
          href="/reports/checklist"
          className="group rounded-xl border border-[#C8102E]/20 bg-white p-4 shadow-sm transition hover:border-[#C8102E] hover:shadow-md active:translate-y-px dark:bg-zinc-900"
        >
          <p className="text-lg font-semibold text-[#C8102E]">Checklist History</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Daily checklist completions, filters, and export.
          </p>
          <p className="mt-3 text-sm font-medium text-zinc-700 group-hover:text-[#C8102E] dark:text-zinc-300">
            Open report →
          </p>
        </Link>
      </nav>
    </section>
  );
}
