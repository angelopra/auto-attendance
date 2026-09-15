import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface KnownPerson {
  id: number;
  name: string;
  selfie_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupPhoto {
  id: number;
  filename: string;
  photo_path: string;
  date: string;
  uploaded_at: string;
  date_edited_at: string | null;
}

/** A known person an unrecognised face resembles, just short of the match threshold. */
export interface FaceSuggestion {
  person: KnownPerson;
  score: number;
}

/** Every photo uploaded for one date. */
export interface PhotoSession {
  date: string;
  photos: GroupPhoto[];
  /** Some photo's date was corrected by hand. */
  edited: boolean;
}

export interface PhotoSessionPage {
  sessions: PhotoSession[];
  /** Sessions matching the search. */
  total: number;
  /** Whether anything was ever uploaded. */
  has_photos: boolean;
}

export type DateOrder = 'dmy' | 'mdy';

export interface AttendanceDetection {
  id: number;
  photo_id: number;
  person_id: number | null;
  face_crop_path: string | null;
  confidence: string | null;
  person: KnownPerson | null;
  suggestion: FaceSuggestion | null;
}

export type AttendanceSource = 'auto' | 'manual';

export interface AttendanceEntry {
  date: string;
  source: AttendanceSource;
  manual_id: number | null;
  note: string | null;
}

export interface AttendanceGridRow {
  person: KnownPerson;
  entries: AttendanceEntry[];
}

/** A window of date columns of the attendance grid. */
export interface AttendanceGridPage {
  dates: string[];
  /** Index of dates[0] among all matching dates. */
  offset: number;
  total_dates: number;
  rows: AttendanceGridRow[];
  edits: AttendanceEdit[];
}

export interface AttendanceGridQuery {
  limit: number;
  /** Omit for the most recent dates. */
  offset?: number | null;
  startDate?: string;
  endDate?: string;
  /** Columns to show even with no presence yet. */
  extraDates?: string[];
  /** Move the window so this date is visible. */
  focusDate?: string;
  /** Also list people absent on every visible date. */
  includeAbsent?: boolean;
}

export interface ManualAttendance {
  id: number;
  person_id: number;
  date: string;
  note: string | null;
  created_at: string;
  person: KnownPerson | null;
}

export interface SessionDay {
  date: string;
  photos: GroupPhoto[];
  detections: AttendanceDetection[];
  manual: ManualAttendance[];
}

export interface AttendanceEdit {
  person_id: number | null;
  person_name: string;
  date: string;
  change: 'added' | 'removed';
  changed_at: string;
}

/** Labels and options for the server-built Excel export. */
export interface AttendanceExportOptions {
  dateOrder: DateOrder;
  /** Rows to add even with no presence yet. */
  extraDates: string[];
  dateLabel: string;
  presentLabel: string;
  manualLabel: string;
  sheetName: string;
}

// ── Dashboards ─────────────────────────────────────────────────────────────

/** How one person attended within the dashboard's range. */
export interface DashboardPersonStat {
  person: KnownPerson;
  attended: number;
  /** Share of the sessions in range, 0..1. */
  rate: number;
  last_seen: string | null;
  /** Sessions attended in a row, counting back from the last one. */
  current_streak: number;
  /** Sessions missed in a row at the end of the range. */
  missed_in_a_row: number;
  /** Presences that were added by hand. */
  manual: number;
}

export interface SessionCount {
  date: string;
  count: number;
}

/** Sessions grouped by weekday (key "1".."7", Monday first) or by month (key "YYYY-MM"). */
export interface PeriodBucket {
  key: string;
  sessions: number;
  presences: number;
}

export interface Dashboard {
  registered_people: number;
  total_presences: number;
  average_attendance: number;
  average_delta: number | null;
  attendance_rate: number;
  new_people: number;
  best_session: SessionCount | null;
  per_session: SessionCount[];
  weekdays: PeriodBucket[];
  /** The last 12 months with sessions. */
  months: PeriodBucket[];
  /** People per attendance-rate band. */
  rate_distribution: number[];
  /** Only people with a presence in range. */
  people: DashboardPersonStat[];
}

export interface AuditLogEntry {
  id: number;
  action: string;
  person_id: number | null;
  person_name: string | null;
  date: string | null;
  details: string | null;
  created_at: string;
}

export interface BackupInfo {
  file_count: number;
  total_bytes: number;
}

export type BackupFormat = 'tar.gz' | 'zip';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '';
  private authToken = '';

  constructor(private http: HttpClient) {
    this.authToken = new URLSearchParams(window.location.search).get('auth') ?? '';
  }

  private auth(url: string): string {
    const sep = url.includes('?') ? '&' : '?';
    return this.authToken ? `${url}${sep}auth=${this.authToken}` : url;
  }

  // ── Persons ──────────────────────────────────────────────────────────────
  getPersons(): Observable<KnownPerson[]> {
    return this.http.get<KnownPerson[]>(this.auth(`${this.base}/persons`));
  }

  createPerson(name: string, selfie: File): Observable<KnownPerson> {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('selfie', selfie);
    return this.http.post<KnownPerson>(this.auth(`${this.base}/persons`), fd);
  }

  updatePerson(id: number, name: string): Observable<KnownPerson> {
    return this.http.patch<KnownPerson>(this.auth(`${this.base}/persons/${id}`), { name });
  }

  /**
   * @deprecated
   */
  mergePersons(sourceIds: number[], targetId: number): Observable<KnownPerson> {
    return this.http.post<KnownPerson>(this.auth(`${this.base}/persons/merge`), {
      source_ids: sourceIds,
      target_id: targetId,
    });
  }

  deletePerson(id: number): Observable<void> {
    return this.http.delete<void>(this.auth(`${this.base}/persons/${id}`));
  }

  // ── Group Photos ──────────────────────────────────────────────────────────
  /** Photos grouped by date, newest first, one page of dates at a time. */
  getPhotoSessions(offset: number, limit: number, search: string, dateOrder: DateOrder): Observable<PhotoSessionPage> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      q: search,
      date_order: dateOrder,
    });
    return this.http.get<PhotoSessionPage>(this.auth(`${this.base}/photos/sessions?${params}`));
  }

  uploadGroupPhoto(date: string, photo: File): Observable<GroupPhoto> {
    const fd = new FormData();
    fd.append('date', date);
    fd.append('photo', photo);
    return this.http.post<GroupPhoto>(this.auth(`${this.base}/photos/upload`), fd);
  }

  /** Move a photo — and every presence it produced — to another date. */
  updatePhotoDate(photoId: number, date: string): Observable<GroupPhoto> {
    return this.http.patch<GroupPhoto>(this.auth(`${this.base}/photos/${photoId}`), { date });
  }

  /** Delete a photo together with every presence it produced. */
  deletePhoto(photoId: number): Observable<void> {
    return this.http.delete<void>(this.auth(`${this.base}/photos/${photoId}`));
  }

  getDetectionsForPhoto(photoId: number): Observable<AttendanceDetection[]> {
    return this.http.get<AttendanceDetection[]>(
      this.auth(`${this.base}/attendance/detections/${photoId}`)
    );
  }

  deleteDetection(detectionId: number): Observable<void> {
    return this.http.delete<void>(
      this.auth(`${this.base}/attendance/detections/${detectionId}`)
    );
  }

  // ── Attendance ────────────────────────────────────────────────────────────
  /** The whole attendance history as an .xlsx file, built by the server. */
  exportAttendance(options: AttendanceExportOptions): Observable<Blob> {
    const params = new URLSearchParams({
      date_order: options.dateOrder,
      date_label: options.dateLabel,
      present_label: options.presentLabel,
      manual_label: options.manualLabel,
      sheet_name: options.sheetName,
    });
    options.extraDates.forEach(date => params.append('extra_dates', date));
    return this.http.get(this.auth(`${this.base}/attendance/export?${params}`), { responseType: 'blob' });
  }

  /** Every number the dashboards show, for the sessions within the range. */
  getDashboard(startDate: string | null, endDate: string | null): Observable<Dashboard> {
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return this.http.get<Dashboard>(this.auth(`${this.base}/dashboards?${params}`));
  }

  /** One page of date columns of the attendance grid, paginated by the backend. */
  getAttendanceGrid(query: AttendanceGridQuery): Observable<AttendanceGridPage> {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.offset != null) params.set('offset', String(query.offset));
    if (query.startDate) params.set('start_date', query.startDate);
    if (query.endDate) params.set('end_date', query.endDate);
    if (query.focusDate) params.set('focus_date', query.focusDate);
    if (query.includeAbsent) params.set('include_absent', 'true');
    query.extraDates?.forEach(date => params.append('extra_dates', date));
    return this.http.get<AttendanceGridPage>(
      this.auth(`${this.base}/attendance/grid?${params}`)
    );
  }

  /** Which person/date cells were touched by hand, and how. */
  getAttendanceEdits(): Observable<AttendanceEdit[]> {
    return this.http.get<AttendanceEdit[]>(this.auth(`${this.base}/attendance/edits`));
  }

  getDay(date: string): Observable<SessionDay> {
    return this.http.get<SessionDay>(this.auth(`${this.base}/attendance/day/${date}`));
  }

  /** Register a presence by hand for a known person. */
  addManualAttendance(personId: number, date: string, note?: string): Observable<ManualAttendance> {
    return this.http.post<ManualAttendance>(this.auth(`${this.base}/attendance/manual`), {
      person_id: personId,
      date,
      note: note ?? null,
    });
  }

  deleteManualAttendance(manualId: number): Observable<void> {
    return this.http.delete<void>(this.auth(`${this.base}/attendance/manual/${manualId}`));
  }

  /** Clear a person's presence on a date, whatever its source. */
  removePresence(personId: number, date: string): Observable<{ removed_detections: number; removed_manual: number }> {
    return this.http.post<{ removed_detections: number; removed_manual: number }>(
      this.auth(`${this.base}/attendance/presence/remove`),
      { person_id: personId, date }
    );
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  getAuditLog(limit = 200): Observable<AuditLogEntry[]> {
    return this.http.get<AuditLogEntry[]>(this.auth(`${this.base}/audit?limit=${limit}`));
  }

  // ── Backup ────────────────────────────────────────────────────────────────
  getBackupInfo(): Observable<BackupInfo> {
    return this.http.get<BackupInfo>(this.auth(`${this.base}/backup/info`));
  }

  backupUrl(format: BackupFormat): string {
    return this.auth(`${this.base}/backup?format=${encodeURIComponent(format)}`);
  }

  imageUrl(path: string | null): string {
    if (!path) return '';
    // Paths stored in DB may include "database/" prefix; static files are
    // mounted at /uploads pointing to database/uploads/, so strip it.
    const normalized = path.replace(/\\/g, '/').replace(/^database\//, '');
    return this.auth(`${this.base}/${normalized}`);
  }
}
