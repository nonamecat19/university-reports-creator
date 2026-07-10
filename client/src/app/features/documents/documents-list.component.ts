import { DatePipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { DocumentService, type DocumentSummary } from '../../core/services/document.service';

@Component({
  selector: 'app-documents-list',
  imports: [FormsModule, RouterLink, Button, Card, Dialog, InputText, DatePipe, TranslatePipe],
  template: `
    <div class="documents-page">
      <div class="page-header">
        <h1>{{ 'documents.title' | translate }}</h1>
        <p-button [label]="'documents.new_document' | translate" icon="pi pi-plus" (onClick)="openCreateDialog()" data-testid="documents-new-btn" />
      </div>

      @if (documents.isLoading()) {
        <p>{{ 'documents.loading' | translate }}</p>
      } @else if (documents.documents().length === 0) {
        <p-card>
          <p>{{ 'documents.empty_state' | translate }}</p>
        </p-card>
      } @else {
        <div class="documents-grid" data-testid="documents-grid">
          @for (doc of documents.documents(); track doc.id) {
            <p-card styleClass="document-card clickable" [routerLink]="['/documents', doc.id]" data-testid="documents-card">
              <ng-template #title>{{ doc.title }}</ng-template>
              <ng-template #subtitle>
                @if (doc.updatedAt) {
                  {{ 'documents.updated' | translate }} {{ doc.updatedAt | date: 'medium' }}
                }
              </ng-template>
              <div class="card-actions" (click)="$event.stopPropagation()">
                <p-button icon="pi pi-pencil" [text]="true" (onClick)="openRenameDialog(doc)" data-testid="documents-rename-btn" />
                <p-button icon="pi pi-trash" [text]="true" severity="danger" (onClick)="remove(doc)" data-testid="documents-delete-btn" />
              </div>
            </p-card>
          }
        </div>
      }
    </div>

    <p-dialog [header]="'documents.new_document_dialog' | translate" [(visible)]="createDialogVisible" [modal]="true" [style]="{ width: '28rem' }" data-testid="documents-create-dialog">
      <div class="field">
        <label for="new-title">{{ 'documents.title_label' | translate }}</label>
        <input pInputText id="new-title" type="text" [(ngModel)]="newTitle" class="w-full" data-testid="documents-create-title-input" />
      </div>
      <div class="dialog-actions">
        <p-button [label]="'documents.cancel' | translate" severity="secondary" (onClick)="createDialogVisible.set(false)" data-testid="documents-create-cancel" />
        <p-button [label]="'documents.create' | translate" [disabled]="!newTitle" (onClick)="create()" data-testid="documents-create-confirm" />
      </div>
    </p-dialog>

    <p-dialog [header]="'documents.rename_document_dialog' | translate" [(visible)]="renameDialogVisible" [modal]="true" [style]="{ width: '28rem' }" data-testid="documents-rename-dialog">
      <div class="field">
        <label for="rename-title">{{ 'documents.title_label' | translate }}</label>
        <input pInputText id="rename-title" type="text" [(ngModel)]="renameTitle" class="w-full" data-testid="documents-rename-title-input" />
      </div>
      <div class="dialog-actions">
        <p-button [label]="'documents.cancel' | translate" severity="secondary" (onClick)="renameDialogVisible.set(false)" data-testid="documents-rename-cancel" />
        <p-button [label]="'documents.save' | translate" [disabled]="!renameTitle" (onClick)="rename()" data-testid="documents-rename-confirm" />
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
    .clickable {
      cursor: pointer;
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
