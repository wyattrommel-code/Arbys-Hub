import { redirect } from "next/navigation";
import { employeeCanAccess, getCurrentEmployee } from "@/lib/auth";

export default async function ScheduleIndexPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (employeeCanAccess(employee, "schedule.full")) {
    redirect("/schedule/builder");
  }
  redirect("/schedule/me");
}
