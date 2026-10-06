// Shared validation and local state. No credentials or server dependencies.
export const OFFLINE_HOURS = 72;
export const OFFLINE_LABELS = {
  clock_in: 'Clock in', clock_out: 'Clock out', break_start: 'Start break', break_end: 'End break',
  forgot_clock_in: 'Forgot to clock in', forgot_clock_out: 'Forgot to clock out',
  forgot_break_start: 'Forgot to start break', forgot_break_end: 'Forgot to end break',
};
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const baseKind = kind => kind.replace(/^forgot_/, '');
export const isReference = value => value == null || uuid(value) || (typeof value === 'string' && value.startsWith('local:') && uuid(value.slice(6)));
export function validateOfflineEvent(event) {
  if (!event || !uuid(event.id) || !uuid(event.employee_id) || !Object.hasOwn(OFFLINE_LABELS, event.kind) ||
      !isReference(event.punch_id) || !isReference(event.break_id) ||
      (event.previous_id != null && !uuid(event.previous_id))) throw new Error('Invalid offline punch.');
  const captured = Date.parse(event.captured_at), occurred = Date.parse(event.occurred_at);
  if (!Number.isFinite(captured) || !Number.isFinite(occurred) || occurred > captured || captured - occurred > 7 * 86400000 ||
      (!event.kind.startsWith('forgot_') && occurred !== captured)) throw new Error('Invalid punch time.');
  if (typeof event.reason !== 'string' || event.reason.length > 1000 ||
      (event.kind.startsWith('forgot_') && event.reason.trim().length < 3)) throw new Error('Enter a reason for the missed time.');
  return event;
}
export function offlineActions(employee, settings = {}) {
  if (employee?.on_break) return ['break_end', 'forgot_break_end'];
  if (employee?.clocked_in) return ['clock_out', 'forgot_clock_out', ...(settings.use_break_punches === false ? [] : ['break_start', 'forgot_break_start'])];
  return ['clock_in', 'forgot_clock_in'];
}
export function projectRoster(snapshot, events = []) {
  const roster = new Map((snapshot?.employees || []).map(employee => [employee.id, { ...employee }]));
  for (const item of [...events].sort((a,b) => a.sequence - b.sequence)) {
    const event = item.event, employee = roster.get(event.employee_id);
    if (!employee) continue;
    employee.previous_id = event.id;
    employee.waiting = true;
    if (item.receipt?.status === 'review' || employee.sync_review) {
      employee.review = true;
      employee.sync_review = true;
      continue; // A held receipt did not change the real timecard.
    }
    const kind = baseKind(event.kind);
    if (kind === 'clock_in') Object.assign(employee, { clocked_in: true, on_break: false, clock_in: event.occurred_at, break_start: null, punch_id: `local:${event.id}`, break_id: null });
    if (kind === 'clock_out') Object.assign(employee, { clocked_in: false, on_break: false, clock_in: null, last_clock_out: event.occurred_at, break_start: null, punch_id: null, break_id: null });
    if (kind === 'break_start') Object.assign(employee, { on_break: true, break_start: event.occurred_at, break_id: `local:${event.id}` });
    if (kind === 'break_end') Object.assign(employee, { on_break: false, break_start: null, break_id: null });
  }
  return [...roster.values()];
}
export function stateMatches(left, right) {
  return ['punch_id','break_id','previous_id'].every(key => (left?.[key] || null) === (right?.[key] || null));
}
export function captureTime(snapshot, deviceNow = Date.now()) {
  // Use the server offset captured with the roster, not the reconnect time.
  return new Date(deviceNow + (snapshot?.clock_offset_ms || 0)).toISOString();
}
export function canCapture(snapshot, deviceNow = Date.now()) {
  const now = Date.parse(captureTime(snapshot, deviceNow));
  return !!snapshot?.lease && now >= Date.parse(snapshot.issued_at) - 60000 && now < Date.parse(snapshot.expires_at);
}
export async function encryptOfflinePin(publicKey, event, pin, managerPin = '') {
  const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const bytes = new TextEncoder().encode(JSON.stringify({ id: event.id, employee_id: event.employee_id, pin, manager_pin: managerPin }));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, bytes));
  return btoa(String.fromCharCode(...encrypted));
}
