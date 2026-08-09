import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { UploadPhoto } from './tabs/upload-photo/upload-photo';
import { KnownFaces } from './tabs/known-faces/known-faces';
import { Attendance } from './tabs/attendance/attendance';
import { Dashboards } from './tabs/dashboards/dashboards';
import { Manage } from './tabs/manage/manage';
import { Language, LanguageService } from './services/language';

export type TabId = 'upload' | 'known' | 'attendance' | 'dashboards' | 'manage';

interface Tab {
  id: TabId;
  labelKey: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, TranslatePipe, UploadPhoto, KnownFaces, Attendance, Dashboards, Manage],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private languageService = inject(LanguageService);

  readonly tabs: Tab[] = [
    { id: 'upload', labelKey: 'nav.upload' },
    { id: 'known', labelKey: 'nav.known' },
    { id: 'attendance', labelKey: 'nav.attendance' },
    { id: 'dashboards', labelKey: 'nav.dashboards' },
    { id: 'manage', labelKey: 'nav.manage' },
  ];

  /** Kept out of the template: the angle brackets would be parsed as a tag. */
  readonly authHintParams = { param: '?auth=<AUTH_TOKEN>' };

  readonly languages = this.languageService.available;
  readonly language = this.languageService.language;

  activeTab = signal<TabId>('upload');
  authorized = signal(false);

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.authorized.set(!!params.get('auth'));
  }

  setTab(t: TabId) { this.activeTab.set(t); }

  setLanguage(event: Event) {
    this.languageService.use((event.target as HTMLSelectElement).value as Language);
  }
}
