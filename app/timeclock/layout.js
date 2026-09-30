import HubClockNav from "@/components/clock/HubClockNav";
export default function TimeClockLayout({ children }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <HubClockNav kioskUrl={process.env.CLOCK_SITE_URL || "/clock"} />
    {children}
  </div>;
}
