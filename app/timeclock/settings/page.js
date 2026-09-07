import AttendanceSettings from "@/components/settings/AttendanceSettings";

export const metadata = {
  title: "Time Clock Settings | Arby's Ops",
};

export default function TimeClockSettingsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-5 sm:px-6">
      <AttendanceSettings />
    </section>
  );
}
