import { AttendanceEntry, KnownPerson } from './api';

/** Placeholder name the backend gives to a face it could not recognise. */
export const unknownName = 'Unknown';

export interface PersonAttendance {
  person: KnownPerson;
  /** date -> how that presence got there */
  entries: Map<string, AttendanceEntry>;
}
