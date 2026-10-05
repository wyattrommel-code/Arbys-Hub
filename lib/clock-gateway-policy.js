// Shared with middleware. Only these resources exist on the clock deployment.
export const DEVICE_COOKIE = 'hub_clock_device';
export const CLOCK_COOKIES = [DEVICE_COOKIE, 'hub_kiosk'];
const routes = {
  '/api/clock/offline/bootstrap': 'GET', '/api/clock/offline/sync': 'POST',
  '/api/clock/status': 'GET', '/api/clock/device/pair': 'POST',
  '/api/clock/unlock': 'POST', '/api/clock/roster': 'GET',
  '/api/clock/corrections': 'POST', '/api/clock/identify': 'POST', '/api/clock/in': 'POST', '/api/clock/out': 'POST',
  '/api/clock/break/start': 'POST', '/api/clock/break/end': 'POST',
};
export function clockRouteAllowed(path, method) {
  if (routes[path] === method) return true;
  return method === 'GET' && /^\/api\/photos\/profile-photos\/payson\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)
    && !path.split('/').some(part => part === '.' || part === '..');
}
export function clockCookies(header = '') {
  return header.split(';').map(part => part.trim()).filter(part => {
    const index = part.indexOf('=');
    return index > 0 && CLOCK_COOKIES.includes(part.slice(0, index));
  }).join('; ');
}
