import { redirect } from "next/navigation";

export default function ScheduleAttendanceRedirect() {
  redirect("/timeclock/attendance");
}
