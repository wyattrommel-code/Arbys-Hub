import ScheduleSectionNav from "@/components/schedule/ScheduleSectionNav";
import { getCurrentEmployee } from "@/lib/auth";

export default async function ScheduleLayout({ children }) {
  const employee = await getCurrentEmployee();

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <ScheduleSectionNav role={employee?.role} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
