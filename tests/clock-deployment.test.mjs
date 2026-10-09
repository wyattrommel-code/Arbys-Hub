import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkClockRoutes, punchRoutes } from '../scripts/check-clock-routes.mjs';

test('deployment guard accepts the complete clock source', () => {
  assert.doesNotThrow(() => checkClockRoutes());
});

test('deployment guard stops a release when Vercel removes a punch route', t => {
  const root = mkdtempSync(join(tmpdir(), 'clock-deployment-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const route of punchRoutes) {
    const file = join(root, 'app/api/clock', route, 'route.js');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'export async function POST() {}');
  }
  assert.doesNotThrow(() => checkClockRoutes(root));
  for (const route of punchRoutes) {
    const file = join(root, 'app/api/clock', route, 'route.js');
    rmSync(file);
    assert.throws(() => checkClockRoutes(root), error =>
      error.message.includes(`app/api/clock/${route}/route.js`) &&
      error.message.includes('.vercelignore'));
    writeFileSync(file, 'export async function POST() {}');
  }
});
