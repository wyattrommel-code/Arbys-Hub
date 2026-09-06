import { redirect } from "next/navigation";
import MyAvailability from "@/components/schedule/MyAvailability";
import { getCurrentEmployee } from "@/lib/auth";

export default async function MyAvailabilityPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  return <MyAvailability employee={employee} />;
}
