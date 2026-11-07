import { Component, ElementRef, computed, inject, input, model, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Icon } from '../icon/icon';
import { ApiService, KnownPerson } from '../../services/api';
import { searchMatch } from '../../tools';

let nextId = 0;

/**
 * Search-as-you-type picker for one person. The chosen person stays chosen (shown in
 * the field) until cleared with the × or by the parent resetting `selected`.
 */
@Component({
  selector: 'app-person-picker',
  standalone: true,
  imports: [TranslatePipe, Icon],
  templateUrl: './person-picker.html',
  styleUrl: './person-picker.scss',
})
export class PersonPicker {
  private api = inject(ApiService);

  options = input.required<KnownPerson[]>();
  label = input('');
  placeholder = input('');
  selected = model<KnownPerson | null>(null);
  /** The field got focus: a chance for the parent to refresh `options`. */
  opened = output<void>();

  readonly listId = `person-picker-${nextId++}`;
  private field = viewChild<ElementRef<HTMLInputElement>>('field');

  query = signal('');
  open = signal(false);
  active = signal(0);

  matches = computed(() => {
    const term = this.query().trim();
    const options = this.options();
    return (term ? options.filter(p => searchMatch(p.name, term)) : options).slice(0, 50);
  });

  onFocus() {
    this.opened.emit();
    this.open.set(true);
  }

  onInput(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
    this.open.set(true);
  }

  onKeydown(event: KeyboardEvent) {
    const count = this.matches().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open.set(true);
      if (count) this.active.update(i => (i + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) this.active.update(i => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      const person = this.matches()[this.active()];
      if (this.open() && person) {
        event.preventDefault();
        this.choose(person);
      }
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  /** Close once focus has really left (an option's mousedown keeps it on the field). */
  onBlur() {
    this.open.set(false);
    this.query.set('');
  }

  choose(person: KnownPerson) {
    this.selected.set(person);
    this.query.set('');
    this.open.set(false);
    this.field()?.nativeElement.blur();
  }

  clear() {
    this.selected.set(null);
    this.query.set('');
  }

  selfieUrl(path: string | null) {
    return this.api.imageUrl(path);
  }
}
