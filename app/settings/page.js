import AttendanceSettings from "@/components/settings/AttendanceSettings";

export const metadata = {
  title: "Settings | Arby's Ops",
};

export default function SettingsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">Store rules for the time clock and attendance flags.</p>
      <div className="mt-8">
        <AttendanceSettings />
      </div>
    </section>
  );
}
