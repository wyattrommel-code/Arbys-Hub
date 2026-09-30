import { createHash } from 'node:crypto';
import { timecardEditState } from './timecard-edit';
export function timecardEditVersion(punch, breaks) {
  return createHash('sha256').update(JSON.stringify(timecardEditState(punch,breaks))).digest('hex');
}
