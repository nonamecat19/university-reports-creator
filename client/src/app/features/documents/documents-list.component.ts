import { DatePipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { DocumentService, type DocumentSummary } from '../../core/services/document.service';

@Component({
  selector: 'app-documents-list',
  imports: [FormsModule, Button, Card, Dialog, InputText, DatePipe],
  template: `
    <div class="documents-page">
      <div class="page-header">
        <h1>Documents</h1>
        <p-button label="New document" icon="pi pi-plus" (onClick)="openCreateDialog()" />
      </div>

      @if (documents.isLoading()) {
        <p>Loading…</p>
      } @else if (documents.documents().length === 0) {
        <p-card>
          <p>No documents yet. Create your first report.</p>
        </p-card>
      } @else {
        <div class="documents-grid">
          @for (doc of documents.documents(); track doc.id) {
            <p-card styleClass="document-card">
              <ng-template #title>{{ doc.title }}</ng-template>
              <ng-template #subtitle>
                @if (doc.updatedAt) {
                  Updated {{ doc.updatedAt | date: 'medium' }}
                }
              </ng-template>
              <div class="card-actions">
                <p-button icon="pi pi-pencil" [text]="true" (onClick)="openRenameDialog(doc)" />
                <p-button icon="pi pi-trash" [text]="true" severity="danger" (onClick)="remove(doc)" />
              </div>
            </p-card>
          }
        </div>
      }
    </div>

    <p-dialog header="New document" [(visible)]="createDialogVisible" [modal]="true" [style]="{ width: '28rem' }">
      <div class="field">
        <label for="new-title">Title</label>
        <input pInputText id="new-title" type="text" [(ngModel)]="newTitle" class="w-full" />
      </div>
      <div class="dialog-actions">
        <p-button label="Cancel" severity="secondary" (onClick)="createDialogVisible.set(false)" />
        <p-button label="Create" [disabled]="!newTitle" (onClick)="create()" />
      </div>
    </p-dialog>

    <p-dialog header="Rename document" [(visible)]="renameDialogVisible" [modal]="true" [style]="{ width: '28rem' }">
      <div class="field">
        <label for="rename-title">Title</label>
        <input pInputText id="rename-title" type="text" [(ngModel)]="renameTitle" class="w-full" />
      </div>
      <div class="dialog-actions">
        <p-button label="Cancel" severity="secondary" (onClick)="renameDialogVisible.set(false)" />
        <p-button label="Save" [disabled]="!renameTitle" (onClick)="rename()" />
      </div>
    </p-dialog>
  `,
  styles: `
    .documents-page {
      padding: 1.5rem;
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .documents-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 1rem;
    }
    .card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.25rem;
    }
    .field {
      margin-bottom: 1rem;
    }
    .field label {
      display: block;
      margin-bottom: 0.35rem;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `,
})
export class DocumentsListComponent implements OnInit {
  protected readonly documents = inject(DocumentService);

  protected readonly createDialogVisible = signal(false);
  protected readonly renameDialogVisible = signal(false);
  protected newTitle = '';
  protected renameTitle = '';
  private renamingId: string | null = null;

  ngOnInit(): void {
    void this.documents.list();
  }

  openCreateDialog(): void {
    this.newTitle = '';
    this.createDialogVisible.set(true);
  }

  async create(): Promise<void> {
    if (!this.newTitle) return;
    await this.documents.create(this.newTitle);
    this.createDialogVisible.set(false);
  }

  openRenameDialog(doc: DocumentSummary): void {
    this.renamingId = doc.id;
    this.renameTitle = doc.title;
    this.renameDialogVisible.set(true);
  }

  async rename(): Promise<void> {
    if (!this.renamingId || !this.renameTitle) return;
    await this.documents.rename(this.renamingId, this.renameTitle);
    this.renameDialogVisible.set(false);
  }

  async remove(doc: DocumentSummary): Promise<void> {
    await this.documents.remove(doc.id);
  }
}
