import AttendanceSettings from "@/components/settings/AttendanceSettings";

export const metadata = {
  title: "Time Clock Settings | Arby's Ops",
};

export default function TimeClockSettingsPage() {
  return (
    <section className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-3 sm:px-4">
      <AttendanceSettings />
    </section>
  );
}
