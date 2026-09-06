import { redirect } from "next/navigation";
import MyTimeOff from "@/components/schedule/MyTimeOff";
import { getCurrentEmployee } from "@/lib/auth";

export default async function MyTimeOffPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  return <MyTimeOff employee={employee} />;
}
