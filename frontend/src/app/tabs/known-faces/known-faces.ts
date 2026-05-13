import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiService, KnownPerson } from '../../services/api';

@Component({
  selector: 'app-known-faces',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './known-faces.html',
  styleUrl: './known-faces.scss',
})
export class KnownFaces implements OnInit {
  persons = signal<KnownPerson[]>([]);
  newName = '';
  newSelfie: File | null = null;
  newPreview: string | null = null;
  editingId: number | null = null;
  editingName = '';
  selectedIds = signal<Set<number>>(new Set());
  mergeTargetId: number | null = null;
  mergeError = signal('');
  error = signal('');
  saving = signal(false);

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.api.getPersons().subscribe({ next: p => this.persons.set(p) });
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
    this.api.updatePerson(p.id, this.editingName).subscribe({
      next: () => { this.editingId = null; this.load(); },
    });
  }

  cancelEdit() { this.editingId = null; }

  deletePerson(id: number) {
    if (!confirm('Delete this person?')) return;
    this.api.deletePerson(id).subscribe({ next: () => this.load() });
  }

  toggleSelect(id: number) {
    const s = new Set(this.selectedIds());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedIds.set(s);
  }

  isSelected(id: number) { return this.selectedIds().has(id); }

  clearSelection() { this.selectedIds.set(new Set()); }

  merge() {
    const targetId = Number(this.mergeTargetId);
    if (!targetId || this.selectedIds().size < 2) {
      this.mergeError.set('Select 2+ faces and pick a merge target among them.');
      return;
    }
    if (!this.selectedIds().has(targetId)) {
      this.mergeError.set('The merge target must also be checked.');
      return;
    }
    const sources = [...this.selectedIds()].filter(id => id !== targetId);
    this.mergeError.set('');
    this.api.mergePersons(sources, targetId).subscribe({
      next: () => { this.selectedIds.set(new Set()); this.mergeTargetId = null; this.load(); },
      error: err => this.mergeError.set('Merge failed: ' + (err.message ?? '')),
    });
  }

  selfieUrl(path: string | null) { return this.api.imageUrl(path); }
}
