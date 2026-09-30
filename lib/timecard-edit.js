import { parseCorrectionTime } from './clock-corrections';

export function parseTimecardEdit(body) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  const time = (value, label, optional = false) => {
    if (optional && (value === null || value === '')) return null;
    const parsed = parseCorrectionTime(value);
    if (!parsed) fail(`Enter a valid ${label} in restaurant time.`);
    return parsed;
  };
  const clock_in = time(body.clock_in, 'clock-in');
  const clock_out = time(body.clock_out, 'clock-out', true);
  if (clock_out && clock_out <= clock_in) fail('Clock-out must be after clock-in.');
  if (!Array.isArray(body.breaks) || body.breaks.length > 50) fail('Provide the shift breaks (up to 50).');
  if (body.breaks.some(row=>!row || typeof row!=="object" || Array.isArray(row))) fail("Invalid break.");
  const breaks = body.breaks.map((row, index) => ({
    id: row.id || null, start: time(row.start, `start for break ${index + 1}`),
    end: time(row.end, `end for break ${index + 1}`, true),
  })).sort((a,b) => a.start.localeCompare(b.start));
  let lastEnd = clock_in;
  for (const row of breaks) {
    if (row.start < clock_in || (clock_out && row.start >= clock_out) ||
      (row.end && (row.end <= row.start || (clock_out && row.end > clock_out)))) fail('Breaks must fall within the shift and end after they start.');
    if (lastEnd === null || row.start < lastEnd) fail('Breaks cannot overlap.');
    if (clock_out && !row.end) fail('End all breaks before closing the shift.');
    if (row.id && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)) fail('Invalid break.');
    lastEnd = row.end;
  }
  const note = String(body.note || '').trim();
  if (note.length < 3 || note.length > 1000) fail('Enter a correction reason (3-1000 characters).');
  if (typeof body.version !== 'string' || !/^[0-9a-f]{64}$/.test(body.version)) fail('Refresh the timecard before editing.');
  return { clock_in, clock_out, breaks, note, version: body.version };
}

export function timecardEditState(punch, breaks) {
  return { clock_in:punch.clock_in, clock_out:punch.clock_out || null,
    revision:punch.edit_revision || 0, on_break:Boolean(punch.on_break), total_break_minutes:punch.total_break_minutes || 0,
    breaks:breaks.map(row=>({id:row.id,start:row.break_start,end:row.break_end || null})).sort((a,b)=>a.id.localeCompare(b.id)) };
}
