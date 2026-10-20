import { requireFeature } from '@/lib/api-auth';
import { secureJson } from '@/lib/security/http';
import { getSupabaseServer } from '@/lib/supabase-server';
import { attendanceReport } from '@/lib/attendance';
import { attendanceExportOptions, buildAttendanceExport } from '@/lib/attendance-export';

export async function GET(request) {
  const { error } = await requireFeature('timeclock.full');
  if (error) return error;
  try {
    const now = new Date();
    const options = attendanceExportOptions(new URL(request.url).searchParams, now);
    const { report } = await attendanceReport(getSupabaseServer(), options.from, options.to, { now });
    const { csv, filename } = buildAttendanceExport(report, options);
    return new Response(csv, { headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    return secureJson({ ok: false, error: error.message || 'Could not export attendance.' }, { status: error.status || 500 });
  }
}
