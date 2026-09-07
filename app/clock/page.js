import ClockKiosk from "@/components/clock/ClockKiosk";

export const metadata = {
  title: "Time Clock | Arby's Ops",
};

export default function ClockPage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <ClockKiosk />
    </div>
  );
}
