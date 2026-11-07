import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, forkJoin } from 'rxjs';
import { Icon } from '../../components/icon/icon';
import { ApiService, PeopleOverview, PersonCategory, PersonOverview } from '../../services/api';
import { unknownName, visitorMaxSessions } from '../../services/attendance-data';
import { LanguageService } from '../../services/language';
import { readStored, searchMatch, writeStored } from '../../tools';

type SortBy = 'name' | 'sessions';

const SORT_STORAGE_KEY = 'auto-attendance.people.sort';

const isSortBy = (value: unknown): value is SortBy => value === 'name' || value === 'sessions';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, Icon],
  templateUrl: './people.html',
  styleUrl: './people.scss',
})
export class People implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  readonly tabs: { id: PersonCategory; labelKey: string }[] = [
    { id: 'usual', labelKey: 'people.tabUsual' },
    { id: 'visitor', labelKey: 'people.tabVisitors' },
    { id: 'dismissed', labelKey: 'people.tabDismissed' },
  ];

  overview = signal<PeopleOverview | null>(null);
  tab = signal<PersonCategory>('usual');
  search = signal('');
  sortBy = signal<SortBy>(readStored(SORT_STORAGE_KEY, 'name', isSortBy));

  message = signal('');
  error = signal('');
  busy = signal(false);

  editingId = signal<number | null>(null);
  editingName = '';

  /** Ids of the selected people. Kept while filtering or switching tabs, to merge across them. */
  selectedIds = signal<Set<number>>(new Set());
  mergeTarget: PersonOverview | null = null;
  mergeError = signal('');

  // ── Add-person dialog ───────────────────────────────────────────────────
  private addDialog = viewChild.required<ElementRef<HTMLDialogElement>>('addDialog');
  private selfieInput = viewChild<ElementRef<HTMLInputElement>>('selfieInput');
  newName = '';
  newSelfie: File | null = null;
  newPreview = signal<string | null>(null);
  addError = signal('');
  saving = signal(false);

  people = computed(() => this.overview()?.people ?? []);

  counts = computed(() => {
    const counts: Record<PersonCategory, number> = { usual: 0, visitor: 0, dismissed: 0 };
    for (const p of this.people()) counts[p.category]++;
    return counts;
  });

  visible = computed(() => {
    this.language.language();
    const term = this.search().trim();
    const byName = (a: PersonOverview, b: PersonOverview) => {
      const aUnknown = a.person.name === unknownName;
      const bUnknown = b.person.name === unknownName;
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return a.person.name.localeCompare(b.person.name, undefined, { sensitivity: 'base' });
    };
    const compare = this.sortBy() === 'sessions'
      ? (a: PersonOverview, b: PersonOverview) => b.sessions - a.sessions || byName(a, b)
      : byName;
    return this.people()
      .filter(p => p.category === this.tab())
      .filter(p => !term || searchMatch(this.displayName(p), term))
      .sort(compare);
  });

  selectedPeople = computed(() => this.people().filter(p => this.selectedIds().has(p.person.id)));

  /** Named people among the selection: the ones a merge can keep. */
  mergeTargets = computed(() => this.selectedPeople().filter(p => p.person.name !== unknownName));

  visitorHint = computed(() => {
    this.language.language();
    const overview = this.overview();
    if (!overview) return '';
    return this.translate.instant('people.visitorHint', {
      percent: overview.visitor_percent,
      max: visitorMaxSessions(overview.total_sessions, overview.visitor_percent),
      total: overview.total_sessions,
    });
  });

  ngOnInit() { this.load(); }

  load() {
    this.api.getPeopleOverview().subscribe({
      next: overview => {
        this.overview.set(overview);
        // Forget selections of people that no longer exist (merged away, deleted).
        const ids = new Set(overview.people.map(p => p.person.id));
        this.selectedIds.update(selected => new Set([...selected].filter(id => ids.has(id))));
      },
      error: err => this.error.set(this.errorText(err)),
    });
  }

  displayName(p: PersonOverview): string {
    return p.person.name === unknownName ? this.translate.instant('common.unknown') : p.person.name;
  }

  setTab(tab: PersonCategory) {
    this.tab.set(tab);
    this.editingId.set(null);
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  onSort(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (!isSortBy(value)) return;
    this.sortBy.set(value);
    writeStored(SORT_STORAGE_KEY, value);
  }

  // ── Add person ──────────────────────────────────────────────────────────
  openAdd() {
    this.resetAdd();
    this.addDialog().nativeElement.showModal();
  }

  closeAdd() {
    this.addDialog().nativeElement.close();
  }

  /** Runs however the dialog closes — Cancel, Esc or after saving. */
  resetAdd() {
    this.newName = '';
    this.newSelfie = null;
    this.setPreview(null);
    this.addError.set('');
    const input = this.selfieInput()?.nativeElement;
    if (input) input.value = '';
  }

  onSelfieChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.newSelfie = file;
    this.setPreview(file ? URL.createObjectURL(file) : null);
  }

  private setPreview(url: string | null) {
    const previous = this.newPreview();
    if (previous) URL.revokeObjectURL(previous);
    this.newPreview.set(url);
  }

  addPerson() {
    const name = this.newName.trim();
    if (!name || !this.newSelfie) {
      this.addError.set(this.translate.instant('people.missingFields'));
      return;
    }
    this.addError.set('');
    this.saving.set(true);
    this.api.createPerson(name, this.newSelfie).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeAdd();
        this.message.set(this.translate.instant('people.added', { name }));
        this.load();
      },
      error: err => {
        this.saving.set(false);
        this.addError.set(this.translate.instant('people.error', { reason: this.errorText(err) }));
      },
    });
  }

  // ── Rename ──────────────────────────────────────────────────────────────
  startEdit(p: PersonOverview) {
    this.editingId.set(p.person.id);
    this.editingName = p.person.name === unknownName ? '' : p.person.name;
  }

  saveEdit(p: PersonOverview) {
    const name = this.editingName.trim();
    if (!name || name === p.person.name) {
      this.cancelEdit();
      return;
    }
    this.api.updatePerson(p.person.id, name).subscribe({
      next: () => { this.editingId.set(null); this.load(); },
      error: err => this.error.set(this.errorText(err)),
    });
  }

  cancelEdit() { this.editingId.set(null); }

  /** Enter commits the rename, Esc drops it. */
  onRenameKey(event: KeyboardEvent, p: PersonOverview) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveEdit(p);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  // ── Dismiss / restore / delete ──────────────────────────────────────────
  dismiss(p: PersonOverview) {
    this.run(this.api.dismissPerson(p.person.id), 'people.dismissed', p);
  }

  restore(p: PersonOverview) {
    this.run(this.api.restorePerson(p.person.id), 'people.restored', p);
  }

  deletePerson(p: PersonOverview) {
    const name = this.displayName(p);
    if (!confirm(this.translate.instant('people.confirmDelete', { name }))) return;
    this.run(this.api.deletePerson(p.person.id), 'people.deleted', p);
  }

  private run(request: Observable<unknown>, doneKey: string, p: PersonOverview) {
    const name = this.displayName(p);
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.selectedIds.update(ids => { const next = new Set(ids); next.delete(p.person.id); return next; });
        this.message.set(this.translate.instant(doneKey, { name }));
        this.load();
      },
      error: err => { this.busy.set(false); this.error.set(this.errorText(err)); },
    });
  }

  // ── Merge ───────────────────────────────────────────────────────────────
  toggleSelect(p: PersonOverview) {
    const s = new Set(this.selectedIds());
    s.has(p.person.id) ? s.delete(p.person.id) : s.add(p.person.id);
    this.selectedIds.set(s);
    if (this.mergeTarget && !s.has(this.mergeTarget.person.id)) this.mergeTarget = null;
  }

  isSelected(p: PersonOverview) { return this.selectedIds().has(p.person.id); }

  clearSelection() {
    this.selectedIds.set(new Set());
    this.mergeTarget = null;
    this.mergeError.set('');
  }

  merge() {
    const target = this.mergeTarget;
    if (!target || this.selectedIds().size < 2) {
      this.mergeError.set(this.translate.instant('people.mergeNeedsTwo'));
      return;
    }
    if (!this.selectedIds().has(target.person.id)) {
      this.mergeError.set(this.translate.instant('people.mergeTargetChecked'));
      return;
    }
    // Renaming onto the target's name merges the whole person into it.
    const sources = this.selectedPeople().filter(p => p.person.id !== target.person.id);
    this.mergeError.set('');
    forkJoin(sources.map(p => this.api.updatePerson(p.person.id, target.person.name))).subscribe({
      next: () => { this.clearSelection(); this.load(); },
      error: err => this.mergeError.set(
        this.translate.instant('people.mergeFailed', { reason: this.errorText(err) })
      ),
    });
  }

  selfieUrl(path: string | null) { return this.api.imageUrl(path); }

  private errorText(err: unknown): string {
    const detail = (err as { error?: { detail?: string } })?.error?.detail;
    return detail ?? (err as { message?: string })?.message ?? this.translate.instant('errors.unexpected');
  }
}
