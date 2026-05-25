import Link from "next/link";
import ChecklistFlash from "@/components/checklist/ChecklistFlash";
import ChecklistWidget from "@/components/checklist/ChecklistWidget";
import { getCurrentEmployee, isManager } from "@/lib/auth";

export default async function ChecklistPage() {
  const employee = await getCurrentEmployee();

  return (
    <section className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <ChecklistFlash />
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Daily Checklist</h2>
          <p className="text-sm text-zinc-500">AM and PM tasks for today</p>
        </div>
        {isManager(employee) ? (
          <Link
            href="/checklist/manage"
            className="shrink-0 rounded-lg border border-[#C8102E] px-3 py-2 text-sm font-semibold text-[#C8102E]"
          >
            Manage Tasks
          </Link>
        ) : null}
      </div>
      <ChecklistWidget mode="full" />
    </section>
  );
}
