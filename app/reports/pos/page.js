import BrinkSalesConnection from "@/components/BrinkSalesConnection";
export const metadata = {title:"PAR sales reports | Arby's Ops"};
export default function PosReportsPage() {
  return <main className="mx-auto max-w-7xl p-4 sm:p-6">
    <h1 className="text-2xl font-bold">PAR sales reports</h1>
    <p className="mt-2 text-sm text-gray-600">Live store sales, employee and manager meals, discounts and item voids. Select a business date to review its saved records.</p>
    <BrinkSalesConnection showReports />
  </main>;
}
