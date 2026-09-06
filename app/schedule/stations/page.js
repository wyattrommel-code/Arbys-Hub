import { redirect } from "next/navigation";
import StationsManager from "@/components/schedule/StationsManager";
import { employeeCanAccess, getCurrentEmployee } from "@/lib/auth";

export default async function StationsPage() {
  const employee = await getCurrentEmployee();
  if (!employeeCanAccess(employee, "schedule.full")) {
    redirect("/?flash=access-denied");
  }
  return <StationsManager />;
}
