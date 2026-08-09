import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { ApiService, AttendanceEdit, AttendanceEntry } from '../../services/api';
import {
  PersonAttendance,
  datesFromRows,
  groupAttendanceRows,
  unknownName,
} from '../../services/attendance-data';
import { LanguageService } from '../../services/language';
import { LocalizedDatePipe } from '../../pipes/localized-date';
import { searchMatch } from '../../tools';
import * as XLSX from 'xlsx';

type AttendanceDataRow = PersonAttendance;

/** How many date columns fit, by viewport width. */
function columnsForWidth(width: number): number {
  if (width < 560) return 3;
  if (width < 900) return 5;
  return 8;
}

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslatePipe, LocalizedDatePipe],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance implements OnInit {
  private api = inject(ApiService);
  private fb = inject(NonNullableFormBuilder);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  rows = signal<AttendanceDataRow[]>([]);
  knownDates = signal<string[]>([]);
  /** Dates typed in while editing, so a brand-new session gets a column. */
  extraDates = signal<string[]>([]);
  /** `name|date` -> the latest by-hand change on that cell. */
  edits = signal<Map<string, AttendanceEdit>>(new Map());

  dateStartIndex = signal<number>(0);
  viewportWidth = signal<number>(typeof window === 'undefined' ? 1200 : window.innerWidth);
  pageSize = computed(() => columnsForWidth(this.viewportWidth()));

  editMode = signal(false);
  busy = signal(false);
  message = signal('');
  error = signal('');
  newDate = signal('');

  filterForm = this.fb.group({
    searchName: [''],
    startDate: [''],
    endDate: ['']
  });

  private formValues = toSignal(this.filterForm.valueChanges, {
    initialValue: this.filterForm.getRawValue()
  });

  allDates = computed(() => {
    const dates = new Set([...this.knownDates(), ...this.extraDates()]);
    return [...dates].sort();
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
    const size = this.pageSize();
    // Safe guard index tracking to prevent out of bounds when list sizes change
    const start = Math.min(this.dateStartIndex(), Math.max(0, dates.length - size));
    return dates.slice(start, start + size);
  });

  filteredRows = computed(() => {
    let rows = this.rows();
    const visibleDates = this.visibleDates();
    let { searchName } = this.formValues();
    // While editing, everyone stays on screen so absences can be filled in.
    if (!this.editMode()) {
      rows = rows.filter(r => visibleDates.some(date => r.entries.has(date)));
    }
    if (!searchName) return rows;
    return rows.filter(r => searchName.split(' ').filter(s => s).some(s => searchMatch(r.person.name, s)));
  });

  @HostListener('window:resize')
  onResize() {
    this.viewportWidth.set(window.innerWidth);
  }

  prevDays() {
    this.dateStartIndex.update(idx => Math.max(0, idx - 1));
  }

  nextDays() {
    this.dateStartIndex.update(idx => {
      const maxIndex = Math.max(0, this.filteredDates().length - this.pageSize());
      return Math.min(maxIndex, idx + 1);
    });
  }

  canGoNext = computed(() => this.dateStartIndex() + this.pageSize() < this.filteredDates().length);

  ngOnInit() {
    this.load();
  }

  load() {
    forkJoin({
      rows: this.api.getAttendance(),
      edits: this.api.getAttendanceEdits(),
    }).subscribe({
      next: ({ rows, edits }) => {
        this.rows.set(groupAttendanceRows(rows).filter(d => d.person.name !== unknownName));
        this.knownDates.set(datesFromRows(rows));
        this.edits.set(new Map(edits.map(e => [editKey(e.person_name, e.date), e])));
      },
      error: err => this.error.set(this.errorText(err)),
    });
  }

  toggleEditMode() {
    this.editMode.update(v => !v);
    this.message.set('');
    this.error.set('');
  }

  entryFor(row: AttendanceDataRow, date: string): AttendanceEntry | undefined {
    return row.entries.get(date);
  }

  wasPresent(row: AttendanceDataRow, date: string): boolean {
    return row.entries.has(date);
  }

  /** True when this exact person/date was added or removed by hand at some point. */
  wasEdited(row: AttendanceDataRow, date: string): boolean {
    return this.edits().has(editKey(row.person.name, date));
  }

  cellTitle(row: AttendanceDataRow, date: string): string {
    const localDate = this.language.formatDate(date);
    const entry = this.entryFor(row, date);
    const edit = this.edits().get(editKey(row.person.name, date));

    if (edit) {
      const when = this.language.formatDateTime(edit.changed_at);
      if (entry?.source === 'manual') return this.translate.instant('attendance.cellEditedAdded', { when });
      if (!entry && edit.change === 'removed') {
        return this.translate.instant('attendance.cellEditedRemoved', { when });
      }
      return this.translate.instant('attendance.cellEdited', { when });
    }

    if (entry) return this.translate.instant('attendance.cellPresent');
    return this.editMode()
      ? this.translate.instant('attendance.cellAdd', { name: row.person.name, date: localDate })
      : this.translate.instant('attendance.cellAbsent');
  }

  togglePresence(row: AttendanceDataRow, date: string) {
    if (!this.editMode() || this.busy()) return;
    const entry = this.entryFor(row, date);
    const localDate = this.language.formatDate(date);
    this.message.set('');
    this.error.set('');

    if (!entry) {
      this.busy.set(true);
      this.api.addManualAttendance(row.person.id, date).subscribe({
        next: () => {
          this.busy.set(false);
          this.message.set(
            this.translate.instant('attendance.added', { name: row.person.name, date: localDate })
          );
          this.load();
        },
        error: err => { this.busy.set(false); this.error.set(this.errorText(err)); },
      });
      return;
    }

    const key = entry.source === 'manual'
      ? 'attendance.confirmRemoveManual'
      : 'attendance.confirmRemoveAuto';
    if (!confirm(this.translate.instant(key, { name: row.person.name, date: localDate }))) return;

    this.busy.set(true);
    this.api.removePresence(row.person.id, date).subscribe({
      next: () => {
        this.busy.set(false);
        this.message.set(
          this.translate.instant('attendance.removed', { name: row.person.name, date: localDate })
        );
        this.load();
      },
      error: err => { this.busy.set(false); this.error.set(this.errorText(err)); },
    });
  }

  addDateColumn() {
    const date = this.newDate();
    if (!date) return;
    if (!this.allDates().includes(date)) {
      this.extraDates.update(d => [...d, date]);
    }
    // Jump the window to the new column.
    const index = this.filteredDates().indexOf(date);
    if (index >= 0) {
      this.dateStartIndex.set(Math.max(0, Math.min(index, this.filteredDates().length - this.pageSize())));
    }
    this.newDate.set('');
  }

  onNewDateInput(event: Event) {
    this.newDate.set((event.target as HTMLInputElement).value);
  }

  selfieUrl(path: string | null) {
    return this.api.imageUrl(path);
  }

  resetFilters() {
    this.filterForm.reset();
    this.dateStartIndex.set(0);
  }

  exportToExcel() {
    const dates = this.allDates();
    const dataRows = this.rows();
    const present = this.translate.instant('attendance.excelPresent');
    const manual = this.translate.instant('attendance.excelManual');

    const worksheetData = [
      [this.translate.instant('attendance.excelDate'), ...dataRows.map(r => r.person.name)]
    ];

    dates.forEach(date => {
      const excelRow: string[] = [this.language.formatDate(date)];

      dataRows.forEach(row => {
        const entry = row.entries.get(date);
        excelRow.push(entry ? (entry.source === 'manual' ? manual : present) : '');
      });

      worksheetData.push(excelRow);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, this.translate.instant('attendance.excelSheet'));

    XLSX.writeFile(
      workbook,
      `attendance_report_${new Date().toISOString().split('T')[0]}.xls`,
      { bookType: 'xls' }
    );
  }

  private errorText(err: unknown): string {
    const detail = (err as { error?: { detail?: string } })?.error?.detail;
    return detail ?? (err as { message?: string })?.message
      ?? this.translate.instant('errors.unexpected');
  }
}

function editKey(name: string, date: string): string {
  return `${name}|${date}`;
}
