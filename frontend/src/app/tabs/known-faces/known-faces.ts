import { CommonModule } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, KnownPerson } from '../../services/api';
import { uniqBy } from '../../tools';
import { forkJoin } from 'rxjs';

export const unknownName = 'Unknown';

@Component({
  selector: 'app-known-faces',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './known-faces.html',
  styleUrl: './known-faces.scss',
})
export class KnownFaces implements OnInit {
  allPersons = signal<KnownPerson[]>([]);
  allKnownPersons = computed(() => this.uniquePersons().filter(p => p.name !== unknownName));
  uniquePersons = computed(() => uniqBy(this.allPersons(), (p, i) => p.name === unknownName ? i : p.name));
  newName = '';
  newSelfie: File | null = null;
  newPreview: string | null = null;
  editingId: number | null = null;
  editingName = '';
  selectedIds = signal<Set<number>>(new Set());
  mergeTarget: KnownPerson | null = null;
  mergeError = signal('');
  error = signal('');
  saving = signal(false);

  constructor(private api: ApiService) {}

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
    reader.onload = e => (this.newPreview = e.target?.result as string);
    reader.readAsDataURL(file);
  }

  addPerson() {
    if (!this.newName || !this.newSelfie) {
      this.error.set('Name and selfie are required.');
      return;
    }
    this.error.set('');
    this.saving.set(true);
    this.api.createPerson(this.newName, this.newSelfie).subscribe({
      next: () => { this.load(); this.newName = ''; this.newSelfie = null; this.newPreview = null; this.saving.set(false); },
      error: err => { this.error.set('Error: ' + (err.message ?? '')); this.saving.set(false); },
    });
  }

  startEdit(p: KnownPerson) { this.editingId = p.id; this.editingName = p.name; }

  saveEdit(p: KnownPerson) {
    this.api.updatePerson(p.id, this.editingName).subscribe(() => { this.editingId = null; this.load(); });
  }

  cancelEdit() { this.editingId = null; }

  deletePerson(id: number) {
    if (!confirm('Delete this person?')) return;
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
      this.mergeError.set('Select 2+ faces and pick a merge target among them.');
      return;
    }
    if (!this.selectedIds().has(target.id)) {
      this.mergeError.set('The merge target must also be checked.');
      return;
    }
    const sources = [...this.selectedIds()].filter(id => id !== target.id);
    this.mergeError.set('');
    forkJoin(sources.map(sourceId => this.api.updatePerson(sourceId, target.name))).subscribe({
      next: () => { this.selectedIds.set(new Set()); this.mergeTarget = null; this.load(); },
      error: err => this.mergeError.set('Merge failed: ' + (err.message ?? '')),
    });
  }

  selfieUrl(path: string | null) { return this.api.imageUrl(path); }
}
