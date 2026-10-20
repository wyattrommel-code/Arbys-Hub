import { requireFeature } from '@/lib/api-auth';
import StationSettings from '@/components/clock/StationSettings';
export const metadata = { title: "Store iPad | Arby's Hub" };
export default async function StationSettingsPage() {
  const { error } = await requireFeature('settings');
  if (error) return <p className="p-6">GM access is required to manage the store iPad.</p>;
  return <section className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8"><h1 className="text-2xl font-semibold">Store iPad</h1><p>Authorize the restaurant’s dedicated time clock.</p><StationSettings clockUrl={process.env.CLOCK_SITE_URL || ''} /></section>;
}
