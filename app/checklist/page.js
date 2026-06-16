import Link from "next/link";
import ChecklistWidget from "@/components/checklist/ChecklistWidget";
import { employeeCanAccess, getCurrentEmployee } from "@/lib/auth";

export default async function ChecklistPage() {
  const employee = await getCurrentEmployee();
  const canManageTasks = employeeCanAccess(employee, "checklists.manage");

  return (
    <section className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Daily Checklist</h2>
          <p className="text-sm text-zinc-500">AM and PM tasks for today</p>
        </div>
        {canManageTasks ? (
          <Link
            href="/checklist/manage"
            className="shrink-0 rounded-lg border border-[#C8102E] px-3 py-2 text-sm font-semibold text-[#C8102E]"
          >
            Manage Tasks
          </Link>
        ) : null}
      </div>
      <ChecklistWidget fullDay />
    </section>
  );
}
