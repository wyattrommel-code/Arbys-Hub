import StationEntry from '@/components/clock/StationEntry';
export const metadata = { title: "Store Time Clock | Arby's", manifest: "/clock.webmanifest", appleWebApp: { capable: true, title: "Store Clock", statusBarStyle: "default" } };
export default function ClockPage() {
  return <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
    {process.env.CLOCK_ONLY === 'true' ? <StationEntry /> : <div className="m-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Use the store iPad to clock in</h1>
      <p>Clock-in, clock-out, and breaks are available on the authorized store iPad. Your timecards remain in the Hub.</p>
      <p>A GM can pair or revoke the iPad under Settings → Store iPad.</p>
    </div>}
  </div>;
}
