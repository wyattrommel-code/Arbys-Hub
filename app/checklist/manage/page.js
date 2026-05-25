import { redirect } from "next/navigation";
import ManageTasksPanel from "@/components/checklist/ManageTasksPanel";
import { getCurrentEmployee, isManager } from "@/lib/auth";

export default async function ChecklistManagePage() {
  const employee = await getCurrentEmployee();
  if (!isManager(employee)) {
    redirect("/checklist?flash=manager-required");
  }

  return (
    <section className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <h2 className="mb-4 text-xl font-semibold">Manage Checklist Tasks</h2>
      <ManageTasksPanel />
    </section>
  );
}
