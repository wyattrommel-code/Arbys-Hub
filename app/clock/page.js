import ClockKiosk from "@/components/clock/ClockKiosk";
import KioskUnlock from "@/components/clock/KioskUnlock";
import { getKioskActor } from "@/lib/security/kiosk";

export const metadata = {
  title: "Time Clock | Arby's Ops",
};

export default async function ClockPage() {
  const unlocked = await getKioskActor();
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      {unlocked ? <ClockKiosk /> : <KioskUnlock />}
    </div>
  );
}
