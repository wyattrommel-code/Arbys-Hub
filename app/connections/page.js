import BrinkSalesConnection from "@/components/BrinkSalesConnection";

export const metadata = { title: "Connections | Arby's Ops" };

export default function ConnectionsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-[#C8102E]">Connections</h1>
      <p className="mb-5 mt-2 text-sm text-gray-600">
        Manage automatic PAR sales sync, retrieve a past business date, and review connection activity.
      </p>
      <BrinkSalesConnection />
    </main>
  );
}
