import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, AttendanceRow } from '../../services/api';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance implements OnInit {
  rows = signal<AttendanceRow[]>([]);
  allDates = signal<string[]>([]);

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.api.getAttendance().subscribe({
      next: rows => {
        this.rows.set(rows);
        const dateSet = new Set<string>();
        rows.forEach(r => r.dates.forEach(d => dateSet.add(d)));
        this.allDates.set([...dateSet].sort());
      },
    });
  }

  wasPresent(row: AttendanceRow, date: string): boolean {
    return row.dates.includes(date);
  }

  selfieUrl(path: string | null) { return this.api.imageUrl(path); }
}
