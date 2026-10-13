import { hasClockDevice, isClockGateway } from '@/lib/security/clock-device';
import { secureJson } from '@/lib/security/http';
export async function GET() {
  if (!(await isClockGateway())) return secureJson({ error: 'Use the dedicated time clock site.' }, { status: 403 });
  try {
    const paired = await hasClockDevice({ throwOnError: true });
    // Keep unlocked for older cached clock clients during a coordinated release.
    return secureJson({ paired, unlocked: paired });
  } catch {
    return secureJson({ error: 'Time clock connection unavailable.' }, { status: 503 });
  }
}
