import { CommonModule } from '@angular/common';
import { Component, computed, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ApiService, KnownPerson } from '../../services/api';
import { unknownName } from '../../services/attendance-data';
import { uniqBy } from '../../tools';
import { forkJoin } from 'rxjs';

export { unknownName };

@Component({
  selector: 'app-known-faces',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './known-faces.html',
  styleUrl: './known-faces.scss',
})
export class KnownFaces implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  allPersons = signal<KnownPerson[]>([]);
  allKnownPersons = computed(() => this.uniquePersons().filter(p => p.name !== unknownName));
  uniquePersons = computed(() => uniqBy(this.allPersons(), (p, i) => p.name === unknownName ? i : p.name)
    .sort((a, b) => {
      if (a.name === unknownName && b.name !== unknownName) {
        return 1;
      }
      if (b.name === unknownName && a.name !== unknownName) {
        return -1;
      }

      return a.name.localeCompare(b.name);
    }));
  newName = '';
  newSelfie: File | null = null;
  newPreview = signal<string | null>(null);
  editingId = signal<number | null>(null);
  editingName = '';
  selectedIds = signal<Set<number>>(new Set());
  mergeTarget: KnownPerson | null = null;
  mergeError = signal('');
  error = signal('');
  saving = signal(false);

  ngOnInit() { this.load(); }

  load() {
    this.api.getPersons().subscribe(p => this.allPersons.set(p));
  }

  onSelfieChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.newSelfie = file;
    const reader = new FileReader();
    // FileReader fires outside change detection, so the preview has to be a signal.
    reader.onload = e => this.newPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  addPerson() {
    if (!this.newName || !this.newSelfie) {
      this.error.set(this.translate.instant('known.missingFields'));
      return;
    }
    this.error.set('');
    this.saving.set(true);
    this.api.createPerson(this.newName, this.newSelfie).subscribe({
      next: () => {
        this.load();
        this.newName = '';
        this.newSelfie = null;
        this.newPreview.set(null);
        this.saving.set(false);
      },
      error: err => {
        this.error.set(this.translate.instant('known.error', { reason: errorText(err, this.translate) }));
        this.saving.set(false);
      },
    });
  }

  startEdit(p: KnownPerson) { this.editingId.set(p.id); this.editingName = p.name; }

  saveEdit(p: KnownPerson) {
    const name = this.editingName.trim();
    if (!name || name === p.name) {
      this.cancelEdit();
      return;
    }
    this.api.updatePerson(p.id, name).subscribe(() => { this.editingId.set(null); this.load(); });
  }

  cancelEdit() { this.editingId.set(null); }

  /** Enter commits the rename, Esc drops it. */
  onRenameKey(event: KeyboardEvent, p: KnownPerson) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveEdit(p);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  deletePerson(id: number) {
    if (!confirm(this.translate.instant('known.confirmDelete'))) return;
    this.api.deletePerson(id).subscribe(() => this.load());
  }

  toggleSelect(id: number) {
    const s = new Set(this.selectedIds());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedIds.set(s);
  }

  isSelected(id: number) { return this.selectedIds().has(id); }

  clearSelection() { this.selectedIds.set(new Set()); }

  merge() {
    const target = this.mergeTarget;
    if (!target || this.selectedIds().size < 2) {
      this.mergeError.set(this.translate.instant('known.mergeNeedsTwo'));
      return;
    }
    if (!this.selectedIds().has(target.id)) {
      this.mergeError.set(this.translate.instant('known.mergeTargetChecked'));
      return;
    }
    const sources = [...this.selectedIds()].filter(id => id !== target.id);
    this.mergeError.set('');
    forkJoin(sources.map(sourceId => this.api.updatePerson(sourceId, target.name))).subscribe({
      next: () => { this.selectedIds.set(new Set()); this.mergeTarget = null; this.load(); },
      error: err => this.mergeError.set(
        this.translate.instant('known.mergeFailed', { reason: errorText(err, this.translate) })
      ),
    });
  }

  selfieUrl(path: string | null) { return this.api.imageUrl(path); }
}

function errorText(err: unknown, translate: TranslateService): string {
  const detail = (err as { error?: { detail?: string } })?.error?.detail;
  return detail ?? (err as { message?: string })?.message ?? translate.instant('errors.unexpected');
}
