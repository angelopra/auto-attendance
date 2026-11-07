import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService, GroupPhoto, AttendanceDetection, KnownPerson } from '../../services/api';
import { unknownName } from '../../services/attendance-data';
import { LocalizedDatePipe } from '../../pipes/localized-date';
import { PhotoViewer } from '../../components/photo-viewer/photo-viewer';
import { PersonPicker } from '../../components/person-picker/person-picker';

@Component({
  selector: 'app-upload-photo',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalizedDatePipe, PhotoViewer, PersonPicker],
  templateUrl: './upload-photo.html',
  styleUrl: './upload-photo.scss',
})
export class UploadPhoto implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  date = signal('');
  fileName = signal('');
  /** Object URL of the chosen file, shown before uploading. */
  preview = signal<string | null>(null);
  /** The preview opened full size, like the photos on the Manage tab. */
  viewerOpen = signal(false);
  private selectedFile: File | null = null;

  uploading = signal(false);
  uploadedPhoto = signal<GroupPhoto | null>(null);
  detections = signal<AttendanceDetection[]>([]);
  error = signal('');
  /** Detections whose "is this {person}?" question was answered with no. */
  dismissedSuggestions = signal<Set<number>>(new Set());
  /** Detection whose suggestion is being accepted right now. */
  acceptingId = signal<number | null>(null);

  /** Who can be picked as the photographer: named people who aren't dismissed. */
  photographers = signal<KnownPerson[]>([]);
  photographer = signal<KnownPerson | null>(null);
  /** The photographer counted present with the last processed photo. */
  uploadedPhotographer = signal<KnownPerson | null>(null);

  ngOnInit() {
    this.loadPhotographers();
  }

  /** Also run when the picker opens: people may have been added on the People tab since. */
  loadPhotographers() {
    this.api.getPeopleOverview().subscribe({
      next: overview => this.photographers.set(
        overview.people
          .filter(p => p.category !== 'dismissed' && p.person.name !== unknownName)
          .map(p => p.person)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      ),
    });
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedFile = file;
    this.fileName.set(file.name);
    this.error.set('');
    this.setPreview(URL.createObjectURL(file));
  }

  /** Swap the preview, releasing the previous object URL. */
  private setPreview(url: string | null) {
    const previous = this.preview();
    if (previous) URL.revokeObjectURL(previous);
    this.preview.set(url);
    this.viewerOpen.set(false);
  }

  onDateChange(event: Event) {
    this.date.set((event.target as HTMLInputElement).value);
  }

  clearSelection() {
    this.selectedFile = null;
    this.setPreview(null);
    this.fileName.set('');
  }

  upload() {
    if (!this.selectedFile || !this.date()) {
      this.error.set(this.translate.instant('upload.missing'));
      return;
    }
    this.error.set('');
    this.uploading.set(true);
    const photographer = this.photographer();
    this.api.uploadGroupPhoto(this.date(), this.selectedFile, photographer?.id).subscribe({
      next: photo => {
        this.uploadedPhoto.set(photo);
        this.uploadedPhotographer.set(photographer);
        this.photographer.set(null);
        this.uploading.set(false);
        this.loadDetections(photo.id);
      },
      error: err => {
        this.error.set(
          this.translate.instant('upload.failed', {
            reason: err?.error?.detail ?? err?.message ?? this.translate.instant('errors.unexpected'),
          })
        );
        this.uploading.set(false);
      },
    });
  }

  loadDetections(photoId: number, done?: () => void) {
    this.api.getDetectionsForPhoto(photoId).subscribe({
      next: d => this.detections.set(d),
      complete: done,
      error: done,
    });
  }

  showSuggestion(d: AttendanceDetection): boolean {
    return !!d.suggestion && !!d.person && !this.dismissedSuggestions().has(d.id);
  }

  /** Yes: label the unknown face with the suggested name, merging it into that person. */
  acceptSuggestion(d: AttendanceDetection) {
    if (!d.suggestion || !d.person || this.acceptingId() !== null) return;
    this.error.set('');
    this.acceptingId.set(d.id);
    this.api.updatePerson(d.person.id, d.suggestion.person.name).subscribe({
      // Stay busy until the refreshed faces arrive, so the question can't be answered twice.
      next: () => this.loadDetections(d.photo_id, () => this.acceptingId.set(null)),
      error: err => {
        this.acceptingId.set(null);
        this.error.set(
          this.translate.instant('upload.suggestionFailed', {
            reason: err?.error?.detail ?? err?.message ?? this.translate.instant('errors.unexpected'),
          })
        );
      },
    });
  }

  /** No: just drop the question. */
  dismissSuggestion(d: AttendanceDetection) {
    this.dismissedSuggestions.update(ids => new Set(ids).add(d.id));
  }

  faceUrl(path: string | null) {
    return this.api.imageUrl(path);
  }
}
