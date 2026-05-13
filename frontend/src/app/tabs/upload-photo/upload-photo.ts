import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiService, GroupPhoto, AttendanceDetection } from '../../services/api';

@Component({
  selector: 'app-upload-photo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './upload-photo.html',
  styleUrl: './upload-photo.scss',
})
export class UploadPhoto {
  date = '';
  selectedFile: File | null = null;
  preview: string | null = null;
  uploading = signal(false);
  uploadedPhoto = signal<GroupPhoto | null>(null);
  detections = signal<AttendanceDetection[]>([]);
  error = signal('');

  constructor(private api: ApiService) {}

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedFile = file;
    const reader = new FileReader();
    reader.onload = e => (this.preview = e.target?.result as string);
    reader.readAsDataURL(file);
  }

  upload() {
    if (!this.selectedFile || !this.date) {
      this.error.set('Please select a photo and a date.');
      return;
    }
    this.error.set('');
    this.uploading.set(true);
    this.api.uploadGroupPhoto(this.date, this.selectedFile).subscribe({
      next: photo => {
        this.uploadedPhoto.set(photo);
        this.uploading.set(false);
        this.loadDetections(photo.id);
      },
      error: err => {
        this.error.set('Upload failed: ' + (err.message ?? 'unknown error'));
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
