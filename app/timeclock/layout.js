import Link from "next/link";

export default function TimeClockLayout({ children }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex justify-end px-4 pt-3">
        <Link
          href="/clock"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[#C8102E] hover:underline"
        >
          Open time clock kiosk
        </Link>
      </div>
      {children}
    </div>
  );
}
