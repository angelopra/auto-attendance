import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, distinctUntilChanged, map, switchMap } from 'rxjs';
import { ApiService, AttendanceEdit, AttendanceEntry, AttendanceGridPage } from '../../services/api';
import { PersonAttendance } from '../../services/attendance-data';
import { LanguageService } from '../../services/language';
import { LocalizedDatePipe } from '../../pipes/localized-date';
import { saveBlob, searchMatch } from '../../tools';

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
  private destroyRef = inject(DestroyRef);

  /** The window of date columns the backend sent for the current request. */
  page = signal<AttendanceGridPage | null>(null);
  loading = signal(false);
  /** Dates typed in while editing, so a brand-new session gets a column. */
  extraDates = signal<string[]>([]);
  /** Requested index of the first visible date; null asks for the most recent dates. */
  dateStartIndex = signal<number | null>(null);

  viewportWidth = signal<number>(typeof window === 'undefined' ? 1200 : window.innerWidth);
  pageSize = computed(() => columnsForWidth(this.viewportWidth()));

  editMode = signal(false);
  busy = signal(false);
  exporting = signal(false);
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

  private requests = new Subject<{ focusDate?: string }>();

  visibleDates = computed(() => this.page()?.dates ?? []);
  totalDates = computed(() => this.page()?.total_dates ?? 0);

  rows = computed<AttendanceDataRow[]>(() =>
    (this.page()?.rows ?? []).map(row => ({
      person: row.person,
      entries: new Map(row.entries.map(entry => [entry.date, entry])),
    })).sort((a, b) => a.person.name.localeCompare(b.person.name))
  );

  /** `name|date` -> the latest by-hand change on that cell. */
  edits = computed(() =>
    new Map<string, AttendanceEdit>((this.page()?.edits ?? []).map(e => [editKey(e.person_name, e.date), e]))
  );

  filteredRows = computed(() => {
    const rows = this.rows();
    const { searchName } = this.formValues();
    if (!searchName) return rows;
    return rows.filter(r => searchName.split(' ').filter(s => s).some(s => searchMatch(r.person.name, s)));
  });

  canGoPrev = computed(() => (this.page()?.offset ?? 0) > 0);
  canGoNext = computed(() => {
    const page = this.page();
    return !!page && page.offset + page.dates.length < page.total_dates;
  });

  constructor() {
    this.requests.pipe(
      switchMap(({ focusDate }) => {
        const { startDate, endDate } = this.filterForm.getRawValue();
        this.loading.set(true);
        return this.api.getAttendanceGrid({
          limit: this.pageSize(),
          offset: this.dateStartIndex(),
          startDate,
          endDate,
          extraDates: this.extraDates(),
          focusDate,
          // While editing, everyone stays on screen so absences can be filled in.
          includeAbsent: this.editMode(),
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: page => {
        this.loading.set(false);
        this.page.set(page);
        this.dateStartIndex.set(page.offset);
      },
      error: err => { this.loading.set(false); this.error.set(this.errorText(err)); },
    });

    // A new date range starts again from its most recent dates.
    this.filterForm.valueChanges.pipe(
      map(({ startDate, endDate }) => `${startDate ?? ''}|${endDate ?? ''}`),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      this.dateStartIndex.set(null);
      this.load();
    });
  }

  @HostListener('window:resize')
  onResize() {
    const previousSize = this.pageSize();
    this.viewportWidth.set(window.innerWidth);
    if (this.pageSize() === previousSize) return;
    // Keep showing the latest dates if that is where the window was.
    if (!this.canGoNext()) this.dateStartIndex.set(null);
    this.load();
  }

  prevDays() {
    if (!this.canGoPrev()) return;
    this.dateStartIndex.update(idx => Math.max(0, (idx ?? 0) - 1));
    this.load();
  }

  nextDays() {
    if (!this.canGoNext()) return;
    this.dateStartIndex.update(idx => (idx ?? 0) + 1);
    this.load();
  }

  ngOnInit() {
    this.load();
  }

  load(focusDate?: string) {
    this.requests.next({ focusDate });
  }

  toggleEditMode() {
    this.editMode.update(v => !v);
    this.message.set('');
    this.error.set('');
    this.load();
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
    if (!this.extraDates().includes(date)) {
      this.extraDates.update(d => [...d, date]);
    }
    // Jump the window to the new column.
    this.load(date);
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
    this.dateStartIndex.set(null);
    this.load();
  }

  /** The server builds the spreadsheet in the current language; the browser only saves it. */
  exportToExcel() {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.error.set('');
    this.api.exportAttendance({
      dateOrder: this.language.dateOrder(),
      extraDates: this.extraDates(),
      dateLabel: this.translate.instant('attendance.excelDate'),
      presentLabel: this.translate.instant('attendance.excelPresent'),
      manualLabel: this.translate.instant('attendance.excelManual'),
      sheetName: this.translate.instant('attendance.excelSheet'),
    }).subscribe({
      next: file => {
        this.exporting.set(false);
        saveBlob(file, `attendance_report_${new Date().toISOString().split('T')[0]}.xlsx`);
      },
      error: err => { this.exporting.set(false); this.error.set(this.errorText(err)); },
    });
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
