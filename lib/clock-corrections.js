import { fromStoreDateTimeLocal, toStoreDateTimeLocal } from './store-time';
export const CORRECTION_LABELS = {
  forgot_clock_in: 'Forgot to clock in', forgot_clock_out: 'Forgot to clock out',
  forgot_break_start: 'Forgot to start break', forgot_break_end: 'Forgot to end break',
};
export function correctionTypes(session) {
  if (!session) return [];
  if (session.action === 'clock_in') return ['forgot_clock_in'];
  if (session.on_break) return ['forgot_break_end'];
  return session.settings?.use_break_punches
    ? ['forgot_clock_out', 'forgot_break_start'] : ['forgot_clock_out'];
}
export function parseCorrectionTime(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) return null;
  const date = fromStoreDateTimeLocal(raw);
  if (!date || !Number.isFinite(date.getTime())) return null;
  if (toStoreDateTimeLocal(date.toISOString()) !== (raw.length === 16 ? raw + ':00' : raw)) return null;
  return date.toISOString();
}
