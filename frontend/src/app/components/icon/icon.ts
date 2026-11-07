import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'plus'
  | 'trash'
  | 'download'
  | 'file-down'
  | 'filter-x'
  | 'pencil'
  | 'check'
  | 'x';

/**
 * A small line icon drawn in the current text colour. Decorative: the button that
 * holds it carries the accessible name (aria-label / title).
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" focusable="false">
      @switch (name()) {
        @case ('plus') { <path d="M5 12h14M12 5v14" /> }
        @case ('trash') {
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 11v6M14 11v6" />
        }
        @case ('download') {
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" />
        }
        @case ('file-down') {
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h6" />
          <path d="M12 18v-6M9 15l3 3 3-3" />
        }
        @case ('filter-x') {
          <path d="M13 3H2l8 9.46V19l4 2v-8.54l.9-1.05" /><path d="m22 3-5 5M17 3l5 5" />
        }
        @case ('pencil') {
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
        }
        @case ('check') { <path d="M20 6 9 17l-5-5" /> }
        @case ('x') { <path d="M18 6 6 18M6 6l12 12" /> }
      }
    </svg>
  `,
  styles: `
    :host { display: inline-flex; flex: none; width: 1.15em; height: 1.15em; }
    svg { width: 100%; height: 100%; }
  `,
})
export class Icon {
  name = input.required<IconName>();
}
