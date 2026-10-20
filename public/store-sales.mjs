// Shared by the dashboard and the standalone roast sheet. No credentials or I/O.
export function salesForDay(rows, date) {
  const hours = new Map();
  let updatedAt = null;
  for (const row of rows || []) {
    if (String(row.sale_date).slice(0, 10) !== date) continue;
    const hour = Number(row.hour_of_day);
    const amount = row.net_sales == null ? NaN : Number(row.net_sales);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(amount)) continue;
    hours.set(hour, Math.round(amount * 100));
    if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) updatedAt = row.updated_at;
  }
  if (!hours.size) return null;
  // Rows are assigned to PAR's business date. Overnight hours stay with the
  // previous evening, not the next calendar day's lunch sales.
  const sum = (matches) => [...hours].reduce((n, [h, cents]) => n + (matches(h) ? cents : 0), 0) / 100;
  return {
    total: sum(() => true), am: sum(h => h >= 4 && h < 14),
    pm: sum(h => h < 4 || h >= 14), updatedAt,
    windows: {
      '6am': sum(h => h >= 6 && h < 14),
      '10am': sum(h => h >= 10 && h < 18),
      '2pm': sum(h => h >= 14 && h < 22),
      '5pm': sum(h => h >= 17 || h < 1),
    },
  };
}

export function storeToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function salesUpdatedLabel(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return 'Update time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

// A missing inventory count is not a count of zero. Only calculate an interval
// after both counts and its cooked quantity have been recorded.
export function roastUsage(rows) {
  const entries = new Map((rows || []).map(row => [String(row.daypart || '').toLowerCase(), row]));
  const count = (daypart, field) => {
    const value = entries.get(daypart)?.[field];
    if (value == null || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const interval = (start, end) => {
    const values = [count(start, 'on_hand'), count(start, 'put_in'), count(end, 'on_hand')];
    return values.includes(null) ? null : Math.max(0, values[0] + values[1] - values[2]);
  };
  const sum = (a, b) => a == null || b == null ? null : a + b;
  const usedAm = sum(interval('6am', '10am'), interval('10am', '2pm'));
  const usedPm = sum(interval('2pm', '5pm'), interval('5pm', 'close'));
  return {
    put6: count('6am', 'put_in'), put10: count('10am', 'put_in'),
    put2: count('2pm', 'put_in'), put5: count('5pm', 'put_in'),
    ohClose: count('close', 'on_hand'), usedAm, usedPm,
    totalRoastUsed: sum(usedAm, usedPm),
  };
}
