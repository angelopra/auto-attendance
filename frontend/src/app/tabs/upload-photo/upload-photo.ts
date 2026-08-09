import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService, GroupPhoto, AttendanceDetection } from '../../services/api';
import { LocalizedDatePipe } from '../../pipes/localized-date';

@Component({
  selector: 'app-upload-photo',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalizedDatePipe],
  templateUrl: './upload-photo.html',
  styleUrl: './upload-photo.scss',
})
export class UploadPhoto {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  date = signal('');
  fileName = signal('');
  /** Signals, not plain fields: the preview is set from a FileReader callback,
   *  which is outside Angular's change detection. */
  preview = signal<string | null>(null);
  private selectedFile: File | null = null;

  uploading = signal(false);
  uploadedPhoto = signal<GroupPhoto | null>(null);
  detections = signal<AttendanceDetection[]>([]);
  error = signal('');

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedFile = file;
    this.fileName.set(file.name);
    this.error.set('');
    const reader = new FileReader();
    reader.onload = e => this.preview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  onDateChange(event: Event) {
    this.date.set((event.target as HTMLInputElement).value);
  }

  clearSelection() {
    this.selectedFile = null;
    this.preview.set(null);
    this.fileName.set('');
  }

  upload() {
    if (!this.selectedFile || !this.date()) {
      this.error.set(this.translate.instant('upload.missing'));
      return;
    }
    this.error.set('');
    this.uploading.set(true);
    this.api.uploadGroupPhoto(this.date(), this.selectedFile).subscribe({
      next: photo => {
        this.uploadedPhoto.set(photo);
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

  loadDetections(photoId: number) {
    this.api.getDetectionsForPhoto(photoId).subscribe({
      next: d => this.detections.set(d),
    });
  }

  faceUrl(path: string | null) {
    return this.api.imageUrl(path);
  }
}
