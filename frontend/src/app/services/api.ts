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

export interface AttendanceDetection {
  id: number;
  photo_id: number;
  person_id: number | null;
  face_crop_path: string | null;
  confidence: string | null;
  person: KnownPerson | null;
}

export type AttendanceSource = 'auto' | 'manual';

export interface AttendanceEntry {
  date: string;
  source: AttendanceSource;
  manual_id: number | null;
  note: string | null;
}

export interface AttendanceRow {
  person: KnownPerson;
  dates: string[];
  entries: AttendanceEntry[];
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
  getPhotos(): Observable<GroupPhoto[]> {
    return this.http.get<GroupPhoto[]>(this.auth(`${this.base}/photos`));
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
  getAttendance(): Observable<AttendanceRow[]> {
    return this.http.get<AttendanceRow[]>(this.auth(`${this.base}/attendance`));
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
