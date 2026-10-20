import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const punchRoutes = [
  'in', 'out', 'break/start', 'break/end', 'corrections', 'offline/sync',
];

// Vercel applies .vercelignore before building. Fail the build if that removed
// a punch handler, instead of publishing a seemingly healthy clock with 404s.
export function checkClockRoutes(root = process.cwd()) {
  const missing = punchRoutes
    .map(route => `app/api/clock/${route}/route.js`)
    .filter(path => !existsSync(resolve(root, path)));
  if (missing.length) {
    throw new Error(`Missing clock punch routes: ${missing.join(', ')}. Check .vercelignore before deploying.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkClockRoutes();
  console.log('Clock punch routes verified.');
}
