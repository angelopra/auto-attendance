import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UploadPhoto } from './tabs/upload-photo/upload-photo';
import { KnownFaces } from './tabs/known-faces/known-faces';
import { Attendance } from './tabs/attendance/attendance';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, UploadPhoto, KnownFaces, Attendance],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  activeTab = signal<'upload' | 'known' | 'attendance'>('upload');
  authorized = signal(false);

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.authorized.set(!!params.get('auth'));
  }

  setTab(t: 'upload' | 'known' | 'attendance') { this.activeTab.set(t); }
}
