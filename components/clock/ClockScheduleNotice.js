'use client';

import { useEffect, useState } from 'react';
import { clockActionScheduleNotice } from '@/lib/clock-schedule';

export default function ClockScheduleNotice({ action, context, settings, offline = false, clockOffset = 0 }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const notice = clockActionScheduleNotice(action, context, settings, now + clockOffset, offline);
  if (!notice) return null;
  return <p role="status" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">{notice}</p>;
}
