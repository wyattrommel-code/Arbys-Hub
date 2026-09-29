import { hasClockDevice, isClockGateway } from '@/lib/security/clock-device';
import { getKioskActor } from '@/lib/security/kiosk';
import { secureJson } from '@/lib/security/http';
export async function GET() {
  if (!(await isClockGateway())) return secureJson({ error: 'Use the dedicated time clock site.' }, { status: 403 });
  const paired = await hasClockDevice();
  return secureJson({ paired, unlocked: paired && !!(await getKioskActor()) });
}
