import { redirect } from "next/navigation";
import MySchedule from "@/components/schedule/MySchedule";
import { getCurrentEmployee } from "@/lib/auth";

export default async function MySchedulePage() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect("/login");
  }

  return <MySchedule employee={employee} />;
}
