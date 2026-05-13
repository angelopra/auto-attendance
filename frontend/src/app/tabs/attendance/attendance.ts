import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ApiService, AttendanceRow, KnownPerson } from '../../services/api';
import { groupBy } from '../../tools';
import { unknownName } from '../known-faces/known-faces';

interface AttendanceDataRow {
  person: KnownPerson;
  dates: Set<string>;
}

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance implements OnInit {
  rows = signal<AttendanceDataRow[]>([]);
  allDates = signal<string[]>([]);

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.api.getAttendance().subscribe({
      next: rows => {
        this.rows.set(groupAttendances(rows));
        const dateSet = new Set<string>();
        rows.forEach(r => r.dates.forEach(d => dateSet.add(d)));
        this.allDates.set([...dateSet].sort());
      },
    });
  }

  wasPresent(row: AttendanceDataRow, date: string): boolean {
    return row.dates.has(date);
  }

  selfieUrl(path: string | null) { return this.api.imageUrl(path); }
}

function groupAttendances(attendances: AttendanceRow[]): AttendanceDataRow[] {
  return Object.values(groupBy(attendances, (a, i) => a.person.name === unknownName ? i : a.person.name)).map(group => ({
    person: group![0].person,
    dates: new Set(group!.flatMap(a => a.dates)),
  }));
}
