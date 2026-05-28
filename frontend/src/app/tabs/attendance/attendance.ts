import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ApiService, AttendanceRow, KnownPerson } from '../../services/api';
import { groupBy, searchMatch } from '../../tools'; // Assuming searchMatch is here
import { unknownName } from '../known-faces/known-faces';

interface AttendanceDataRow {
  person: KnownPerson;
  dates: Set<string>;
}

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance implements OnInit {
  private api = inject(ApiService);
  private fb = inject(NonNullableFormBuilder);

  rows = signal<AttendanceDataRow[]>([]);
  allDates = signal<string[]>([]);
  
  // Pagination window state
  dateStartIndex = signal<number>(0);

  // Reactive Filters Form
  filterForm = this.fb.group({
    searchName: [''],
    startDate: [''],
    endDate: ['']
  });

  private formValues = toSignal(this.filterForm.valueChanges, {
    initialValue: this.filterForm.getRawValue()
  });

  filteredDates = computed(() => {
    const dates = this.allDates();
    const { startDate, endDate } = this.formValues();

    let result = [...dates];
    if (startDate) result = result.filter(d => d >= startDate);
    if (endDate) result = result.filter(d => d <= endDate);
    
    return result;
  });

  visibleDates = computed(() => {
    const dates = this.filteredDates();
    // Safe guard index tracking to prevent out of bounds when list sizes change
    const start = Math.min(this.dateStartIndex(), Math.max(0, dates.length - 5));
    return dates.slice(start, start + 5);
  });

  filteredRows = computed(() => {
    let rows = this.rows();
    const visibleDates = this.visibleDates();
    let { searchName } = this.formValues();
    rows = rows.filter(r => visibleDates.some(date => r.dates.has(date)));
    if (!searchName) return rows;
    return rows.filter(r => searchName.split(' ').filter(s => s).some(s => searchMatch(r.person.name, s)));
  });

  prevDays() {
    this.dateStartIndex.update(idx => Math.max(0, idx - 1));
  }

  nextDays() {
    this.dateStartIndex.update(idx => {
      const maxIndex = Math.max(0, this.filteredDates().length - 5);
      return Math.min(maxIndex, idx + 1);
    });
  }

  ngOnInit() { 
    this.load(); 
  }

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

  selfieUrl(path: string | null) { 
    return this.api.imageUrl(path); 
  }

  resetFilters() {
    this.filterForm.reset();
  }
}

function groupAttendances(attendances: AttendanceRow[]): AttendanceDataRow[] {
  return Object.values(groupBy(attendances, (a, i) => a.person.name === unknownName ? i : a.person.name)).map(group => ({
    person: group![0].person,
    dates: new Set(group!.flatMap(a => a.dates)),
  }));
}
