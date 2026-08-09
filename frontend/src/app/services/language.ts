import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export type Language = 'pt' | 'en';

export const DEFAULT_LANGUAGE: Language = 'pt';
export const LANGUAGES: readonly Language[] = ['pt', 'en'];

const STORAGE_KEY = 'auto-attendance.lang';

/** How each language writes a plain date. */
const DATE_ORDER: Record<Language, 'dmy' | 'mdy'> = {
  pt: 'dmy',
  en: 'mdy',
};

/** BCP 47 tags, used for `<html lang>` — native date pickers follow it. */
const HTML_LANG: Record<Language, string> = {
  pt: 'pt-BR',
  en: 'en-US',
};

function isLanguage(value: unknown): value is Language {
  return value === 'pt' || value === 'en';
}

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  private readonly current = signal<Language>(DEFAULT_LANGUAGE);

  /** The active language. Read it to make a computed react to language changes. */
  readonly language = this.current.asReadonly();
  readonly available = LANGUAGES;

  private readonly order = computed(() => DATE_ORDER[this.current()]);

  /** Applied by an app initializer, before anything renders. */
  init() {
    const stored = this.read();
    this.current.set(stored);
    this.applyDocumentLang(stored);
    return this.translate.use(stored);
  }

  use(language: Language) {
    if (language === this.current()) return;
    this.current.set(language);
    this.applyDocumentLang(language);
    this.translate.use(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Private mode or a blocked storage: the choice just won't survive a reload.
    }
  }

  private applyDocumentLang(language: Language) {
    document.documentElement.lang = HTML_LANG[language];
  }

  private read(): Language {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLanguage(stored)) return stored;
    } catch {
      // Fall through to the default.
    }
    return DEFAULT_LANGUAGE;
  }

  /**
   * Format an ISO date (`YYYY-MM-DD`) the way the active language writes it.
   * Anything that is not an ISO date is passed through untouched.
   */
  formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match) return iso;
    const [, year, month, day] = match;
    return this.order() === 'dmy' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  }

  /** Day and month only — for tight spots such as a chart axis. */
  formatDayMonth(iso: string | null | undefined): string {
    if (!iso) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match) return iso;
    const [, , month, day] = match;
    return this.order() === 'dmy' ? `${day}/${month}` : `${month}/${day}`;
  }

  /** Date plus time, for timestamps such as "uploaded at". */
  formatDateTime(value: string | null | undefined): string {
    if (!value) return '';
    // Backend timestamps are naive UTC; mark them as such before converting.
    const utc = /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
    const date = new Date(utc);
    if (Number.isNaN(date.getTime())) return value;

    const pad = (n: number) => String(n).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const datePart = this.order() === 'dmy'
      ? `${day}/${month}/${date.getFullYear()}`
      : `${month}/${day}/${date.getFullYear()}`;

    if (this.order() === 'dmy') {
      return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    const hour = date.getHours() % 12 || 12;
    const suffix = date.getHours() < 12 ? 'AM' : 'PM';
    return `${datePart} ${hour}:${pad(date.getMinutes())} ${suffix}`;
  }
}
