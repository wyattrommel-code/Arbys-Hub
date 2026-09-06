import { redirect } from "next/navigation";
import ScheduleBuilder from "@/components/schedule/ScheduleBuilder";
import { employeeCanAccess, getCurrentEmployee } from "@/lib/auth";

export default async function ScheduleBuilderPage() {
  const employee = await getCurrentEmployee();
  if (!employeeCanAccess(employee, "schedule.full")) {
    redirect("/?flash=access-denied");
  }

  return <ScheduleBuilder />;
}
