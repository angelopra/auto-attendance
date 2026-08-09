import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from '../services/language';

/**
 * `2026-01-06` -> `06/01/2026` (pt) or `01/06/2026` (en).
 *
 * Impure so the whole page reflows when the language changes; the inputs are short
 * strings and the formatting is a regex plus a template literal.
 */
@Pipe({ name: 'localizedDate', standalone: true, pure: false })
export class LocalizedDatePipe implements PipeTransform {
  private language = inject(LanguageService);

  transform(value: string | null | undefined, style: 'full' | 'dayMonth' = 'full'): string {
    return style === 'dayMonth'
      ? this.language.formatDayMonth(value)
      : this.language.formatDate(value);
  }
}

/** Same idea for the backend's naive-UTC timestamps. */
@Pipe({ name: 'localizedDateTime', standalone: true, pure: false })
export class LocalizedDateTimePipe implements PipeTransform {
  private language = inject(LanguageService);

  transform(value: string | null | undefined): string {
    return this.language.formatDateTime(value);
  }
}
