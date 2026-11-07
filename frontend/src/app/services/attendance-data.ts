import { AttendanceEntry, KnownPerson } from './api';

/** Placeholder name the backend gives to a face it could not recognise. */
export const unknownName = 'Unknown';

export interface PersonAttendance {
  person: KnownPerson;
  /** date -> how that presence got there */
  entries: Map<string, AttendanceEntry>;
}

/**
 * The most sessions a visitor can have attended. A visitor was present in fewer than
 * `percent`% of the `total` sessions ever recorded (see reports.VISITOR_PERCENT).
 */
export function visitorMaxSessions(total: number, percent: number): number {
  return Math.max(0, Math.ceil((total * percent) / 100) - 1);
}
