import { groupBy } from '../tools';
import { AttendanceEntry, AttendanceRow, KnownPerson } from './api';

/** Placeholder name the backend gives to a face it could not recognise. */
export const unknownName = 'Unknown';

export interface PersonAttendance {
  person: KnownPerson;
  /** date -> how that presence got there */
  entries: Map<string, AttendanceEntry>;
}

/**
 * Collapse the raw rows into one row per person.
 *
 * Labelling a face renames its row rather than merging it, so the same person can
 * own several rows; they are joined here by name. Unknown faces keep one row each.
 */
export function groupAttendanceRows(rows: AttendanceRow[]): PersonAttendance[] {
  return Object.values(
    groupBy(rows, (row, i) => (row.person.name === unknownName ? i : row.person.name))
  ).map(group => {
    const entries = new Map<string, AttendanceEntry>();
    group!.flatMap(row => row.entries ?? []).forEach(entry => {
      const existing = entries.get(entry.date);
      // A face recognised in a photo outranks a hand-added entry for the same day.
      if (!existing || (existing.source === 'manual' && entry.source === 'auto')) {
        entries.set(entry.date, entry);
      }
    });
    return { person: group![0].person, entries };
  });
}

/** Every date that has any attendance recorded against it. */
export function datesFromRows(rows: AttendanceRow[]): string[] {
  const dates = new Set<string>();
  rows.forEach(row => row.dates.forEach(date => dates.add(date)));
  return [...dates].sort();
}
