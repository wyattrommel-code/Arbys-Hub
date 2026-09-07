import { redirect } from "next/navigation";
import { employeeCanAccess, getCurrentEmployee } from "@/lib/auth";

export const metadata = {
  title: "Time Clock | Arby's Ops",
};

export default async function TimeClockIndexPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (!employeeCanAccess(employee, "timeclock.full")) {
    redirect("/?flash=access-denied");
  }
  redirect("/timeclock/attendance");
}
