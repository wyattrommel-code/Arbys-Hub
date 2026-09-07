import Link from "next/link";

export const metadata = {
  title: "Settings | Arby's Ops",
};

export default function SettingsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">Store-wide Hub settings.</p>
      <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Time clock & attendance</p>
        <p className="mt-1 text-sm text-zinc-500">
          Grace minutes, face/photo capture, and break subtraction live with the Time Clock tools.
        </p>
        <Link
          href="/timeclock/settings"
          className="mt-3 inline-block text-sm font-semibold text-[#C8102E] hover:underline"
        >
          Open Time Clock settings
        </Link>
      </div>
    </section>
  );
}
