import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ApiService,
  AttendanceDetection,
  AuditLogEntry,
  BackupFormat,
  BackupInfo,
  GroupPhoto,
} from '../../services/api';
import { LanguageService } from '../../services/language';
import { LocalizedDatePipe, LocalizedDateTimePipe } from '../../pipes/localized-date';
import { groupBy } from '../../tools';

interface SessionGroup {
  date: string;
  photos: GroupPhoto[];
  edited: boolean;
}

const ACTION_KEYS: Record<string, string> = {
  presence_added: 'manage.actionPresenceAdded',
  presence_removed: 'manage.actionPresenceRemoved',
  detection_removed: 'manage.actionDetectionRemoved',
  photo_date_changed: 'manage.actionPhotoDateChanged',
  photo_deleted: 'manage.actionPhotoDeleted',
  person_deleted: 'manage.actionPersonDeleted',
};

@Component({
  selector: 'app-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalizedDatePipe, LocalizedDateTimePipe],
  templateUrl: './manage.html',
  styleUrl: './manage.scss',
})
export class Manage implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  photos = signal<GroupPhoto[]>([]);
  audit = signal<AuditLogEntry[]>([]);
  backupInfo = signal<BackupInfo | null>(null);
  backupFormat = signal<BackupFormat>('tar.gz');

  expandedPhotoId = signal<number | null>(null);
  detections = signal<AttendanceDetection[]>([]);
  loadingDetections = signal(false);

  editingPhotoId = signal<number | null>(null);
  editingDate = signal('');

  busy = signal(false);
  message = signal('');
  error = signal('');

  sessionFilter = signal('');
  visibleSessionCount = signal(15);

  private allSessions = computed<SessionGroup[]>(() => {
    const grouped = groupBy(this.photos(), p => p.date);
    return Object.keys(grouped)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({
        date,
        photos: grouped[date]!,
        edited: grouped[date]!.some(p => !!p.date_edited_at),
      }));
  });

  matchingSessions = computed(() => {
    const term = this.sessionFilter().trim().toLowerCase();
    if (!term) return this.allSessions();
    return this.allSessions().filter(
      session =>
        session.date.includes(term) ||
        this.language.formatDate(session.date).includes(term) ||
        session.photos.some(p => p.filename.toLowerCase().includes(term))
    );
  });

  sessions = computed(() => this.matchingSessions().slice(0, this.visibleSessionCount()));

  hiddenSessions = computed(() =>
    Math.max(0, this.matchingSessions().length - this.sessions().length)
  );

  onSessionFilter(event: Event) {
    this.sessionFilter.set((event.target as HTMLInputElement).value);
    this.visibleSessionCount.set(15);
  }

  showMoreSessions() {
    this.visibleSessionCount.update(n => n + 30);
  }

  ngOnInit() {
    this.loadPhotos();
    this.loadAudit();
    this.loadBackupInfo();
  }

  loadPhotos() {
    this.api.getPhotos().subscribe({
      next: p => this.photos.set(p),
      error: err => this.error.set(this.errorText(err)),
    });
  }

  loadAudit() {
    this.api.getAuditLog(200).subscribe({
      next: a => this.audit.set(a),
      error: err => this.error.set(this.errorText(err)),
    });
  }

  loadBackupInfo() {
    this.api.getBackupInfo().subscribe({ next: info => this.backupInfo.set(info) });
  }

  // ── Backup ──────────────────────────────────────────────────────────────
  backupHref = computed(() => this.api.backupUrl(this.backupFormat()));

  onFormatChange(event: Event) {
    this.backupFormat.set((event.target as HTMLSelectElement).value as BackupFormat);
  }

  humanSize(bytes: number | undefined): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  // ── Sessions ────────────────────────────────────────────────────────────
  toggleDetections(photo: GroupPhoto) {
    if (this.expandedPhotoId() === photo.id) {
      this.expandedPhotoId.set(null);
      this.detections.set([]);
      return;
    }
    this.expandedPhotoId.set(photo.id);
    this.detections.set([]);
    this.loadingDetections.set(true);
    this.api.getDetectionsForPhoto(photo.id).subscribe({
      next: d => { this.detections.set(d); this.loadingDetections.set(false); },
      error: err => { this.error.set(this.errorText(err)); this.loadingDetections.set(false); },
    });
  }

  startEditDate(photo: GroupPhoto) {
    this.editingPhotoId.set(photo.id);
    this.editingDate.set(photo.date);
    this.message.set('');
    this.error.set('');
  }

  cancelEditDate() {
    this.editingPhotoId.set(null);
  }

  onEditingDateInput(event: Event) {
    this.editingDate.set((event.target as HTMLInputElement).value);
  }

  saveDate(photo: GroupPhoto) {
    const date = this.editingDate();
    if (!date || date === photo.date) {
      this.editingPhotoId.set(null);
      return;
    }
    this.busy.set(true);
    this.api.updatePhotoDate(photo.id, date).subscribe({
      next: () => {
        this.busy.set(false);
        this.editingPhotoId.set(null);
        this.message.set(this.translate.instant('manage.photoMoved', {
          from: this.language.formatDate(photo.date),
          to: this.language.formatDate(date),
        }));
        this.refresh();
      },
      error: err => { this.busy.set(false); this.error.set(this.errorText(err)); },
    });
  }

  deletePhoto(photo: GroupPhoto) {
    const confirmed = confirm(this.translate.instant('manage.confirmDeletePhoto', {
      name: photo.filename,
      date: this.language.formatDate(photo.date),
    }));
    if (!confirmed) return;

    this.busy.set(true);
    this.api.deletePhoto(photo.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.expandedPhotoId.set(null);
        this.message.set(this.translate.instant('manage.photoDeleted', {
          date: this.language.formatDate(photo.date),
        }));
        this.refresh();
      },
      error: err => { this.busy.set(false); this.error.set(this.errorText(err)); },
    });
  }

  deleteDetection(detection: AttendanceDetection) {
    const who = detection.person?.name ?? this.translate.instant('common.unknown');
    if (!confirm(this.translate.instant('manage.confirmRemoveFace', { name: who }))) return;

    this.busy.set(true);
    this.api.deleteDetection(detection.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.detections.update(list => list.filter(d => d.id !== detection.id));
        this.message.set(this.translate.instant('manage.faceRemoved'));
        this.loadAudit();
      },
      error: err => { this.busy.set(false); this.error.set(this.errorText(err)); },
    });
  }

  refresh() {
    this.loadPhotos();
    this.loadAudit();
    this.loadBackupInfo();
  }

  imageUrl(path: string | null) {
    return this.api.imageUrl(path);
  }

  actionLabel(action: string): string {
    const key = ACTION_KEYS[action];
    return key ? this.translate.instant(key) : action;
  }

  actionKind(action: string): 'add' | 'remove' | 'move' {
    if (action === 'presence_added') return 'add';
    if (action === 'photo_date_changed') return 'move';
    return 'remove';
  }

  private errorText(err: unknown): string {
    const detail = (err as { error?: { detail?: string } })?.error?.detail;
    return detail ?? (err as { message?: string })?.message
      ?? this.translate.instant('errors.unexpected');
  }
}
