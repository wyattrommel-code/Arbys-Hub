import EquipmentDetail from "@/components/equipment/EquipmentDetail";
export const metadata = { title: "Equipment | Arby's Ops" };
export default async function EquipmentPage({ params }) { const { id } = await params; return <EquipmentDetail key={id} id={id} />; }
