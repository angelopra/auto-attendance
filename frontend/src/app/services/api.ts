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
}

export interface AttendanceDetection {
  id: number;
  photo_id: number;
  person_id: number | null;
  face_crop_path: string | null;
  confidence: string | null;
  person: KnownPerson | null;
}

export interface AttendanceRow {
  person: KnownPerson;
  dates: string[];
}

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

  getDetectionsForPhoto(photoId: number): Observable<AttendanceDetection[]> {
    return this.http.get<AttendanceDetection[]>(
      this.auth(`${this.base}/attendance/detections/${photoId}`)
    );
  }

  // ── Attendance ────────────────────────────────────────────────────────────
  getAttendance(): Observable<AttendanceRow[]> {
    return this.http.get<AttendanceRow[]>(this.auth(`${this.base}/attendance`));
  }

  imageUrl(path: string | null): string {
    if (!path) return '';
    // Paths stored in DB may include "database/" prefix; static files are
    // mounted at /uploads pointing to database/uploads/, so strip it.
    const normalized = path.replace(/\\/g, '/').replace(/^database\//, '');
    return this.auth(`${this.base}/${normalized}`);
  }
}
