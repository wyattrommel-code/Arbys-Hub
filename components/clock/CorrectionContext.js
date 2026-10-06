import { formatStoreDateTime } from '@/lib/store-time';

export default function CorrectionContext({ type, clockIn, breakStart, lastClockOut }) {
  const times = type === 'forgot_clock_in'
    ? [['Last clock-out', lastClockOut]]
    : [['Clocked in', clockIn], ...(type === 'forgot_break_end' ? [['Break started', breakStart]] : [])];
  return <section aria-label="Recorded times" className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Recorded times · Restaurant time</p>
    <dl className="space-y-2 text-sm">
      {times.map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="text-zinc-600 dark:text-zinc-300">{label}</dt>
        <dd className="font-semibold">{value && Number.isFinite(Date.parse(value)) ? <time dateTime={value}>{formatStoreDateTime(value)}</time> : 'No recent time available'}</dd>
      </div>)}
    </dl>
  </section>;
}
