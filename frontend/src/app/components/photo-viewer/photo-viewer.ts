import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

/** A photo shown full size over a dimmed page; a click anywhere but the photo, or Esc, closes it. */
@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="photo-viewer" role="dialog" aria-modal="true" [attr.aria-label]="alt()" (click)="closed.emit()">
      <img [src]="src()" [alt]="alt()" (click)="$event.stopPropagation()" />
    </div>
  `,
  styles: `
    .photo-viewer {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: rgba(10, 12, 20, 0.86);
      cursor: zoom-out;
      animation: fade 0.15s ease;
    }

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: var(--radius);
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
      cursor: default;
    }

    @keyframes fade { from { opacity: 0; } }
  `,
})
export class PhotoViewer {
  src = input.required<string>();
  alt = input('');
  closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closed.emit();
  }
}
