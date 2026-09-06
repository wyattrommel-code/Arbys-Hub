import { redirect } from "next/navigation";
import ManageAvailability from "@/components/schedule/ManageAvailability";
import { employeeCanAccess, getCurrentEmployee } from "@/lib/auth";

export default async function ManageAvailabilityPage() {
  const employee = await getCurrentEmployee();
  if (!employeeCanAccess(employee, "schedule.full")) {
    redirect("/?flash=access-denied");
  }
  const reviewerName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
  return <ManageAvailability reviewerName={reviewerName} />;
}
