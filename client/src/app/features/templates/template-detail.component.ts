import { DatePipe } from '@angular/common';
import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Template } from '@gen/template/template';
import { type ReportType, Visibility } from '@gen/template/template';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { DocumentService } from '../../core/services/document.service';
import {
  getReportTypeLabel,
  getReportTypeSeverity,
  getVisibilityLabel,
  timestampToDate,
} from '../../shared/models/template.model';
import { TemplateService } from './template.service';

@Component({
  selector: 'app-template-detail',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    Card,
    Button,
    Dialog,
    InputText,
    Tag,
    Tooltip,
    TranslatePipe,
  ],
  template: `
    <div class="page-header">
      <div class="header-content">
        <p-button routerLink="/templates" variant="text" icon="pi pi-arrow-left" data-testid="template-detail-back" />
        <div class="header-text">
          <h1 data-testid="template-detail-name">{{ template()?.name }}</h1>
          <p>{{ template()?.description }}</p>
        </div>
      </div>
      <div class="header-actions">
        @if (!template()?.confirmed) {
          <p-button
            [label]="'template_detail.confirm' | translate"
            icon="pi pi-check"
            severity="secondary"
            [loading]="confirming()"
            (onClick)="confirmTemplate()"
          />
        }
        <p-button
          [label]="'template_detail.use_template' | translate"
          icon="pi pi-plus"
          severity="primary"
          [disabled]="!template()?.confirmed"
          [pTooltip]="template()?.confirmed ? '' : ('template_detail.confirm_first' | translate)"
          (onClick)="openUseTemplateDialog()"
        />
      </div>
    </div>

    @if (loading()) {
      <div class="loading-state">
        <i class="pi pi-spinner pi-spin"></i>
        <p>{{ 'template_detail.loading' | translate }}</p>
      </div>
    } @else if (template()) {
      @if (template()!; as t) {
        <div class="content-grid">
          <p-card styleClass="info-card">
            <ng-template #title>{{ 'template_detail.template_info' | translate }}</ng-template>

            <div class="info-grid" data-testid="template-detail-info">
              <div class="info-item">
                <span class="label">{{ 'template_detail.report_type' | translate }}</span>
                <p-tag
                  [value]="getReportTypeLabel(t.reportType) | translate"
                  [severity]="getReportTypeSeverity(t.reportType)"
                />
              </div>
              <div class="info-item">
                <span class="label">{{ 'template_detail.visibility' | translate }}</span>
                <p-tag
                  [value]="getVisibilityLabel(t.visibility) | translate"
                  [severity]="t.visibility === Visibility.PUBLIC ? 'success' : 'secondary'"
                />
              </div>
              <div class="info-item">
                <span class="label">{{ 'template_detail.version' | translate }}</span>
                <span class="value">{{ t.currentVersion }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'template_detail.created' | translate }}</span>
                <span class="value">{{ formatDate(t.createdAt) | date: 'mediumDate' }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'template_detail.last_updated' | translate }}</span>
                <span class="value">{{ formatDate(t.updatedAt) | date: 'mediumDate' }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'template_detail.owner_id' | translate }}</span>
                <span class="value">{{ t.ownerId }}</span>
              </div>
            </div>
          </p-card>

          @if (t.modelJson) {
            <p-card styleClass="model-card">
              <ng-template #title>{{ 'template_detail.template_model' | translate }}</ng-template>
              <pre class="model-json">{{ t.modelJson }}</pre>
            </p-card>
          } @else {
            <p-card styleClass="empty-card">
              <ng-template #title>{{ 'template_detail.template_model' | translate }}</ng-template>
              <div class="empty-model">
                <i class="pi pi-file"></i>
                <p>{{ 'template_detail.no_model' | translate }}</p>
              </div>
            </p-card>
          }
        </div>
      }
    } @else {
      <div class="not-found">
        <i class="pi pi-file-not-found"></i>
        <h2>{{ 'template_detail.template_not_found' | translate }}</h2>
        <p-button routerLink="/templates" [label]="'template_detail.back_to_templates' | translate" />
      </div>
    }

    <p-dialog [header]="'template_detail.use_template_dialog' | translate" [(visible)]="useTemplateDialogVisible" [modal]="true" [style]="{ width: '28rem' }">
      <div class="field">
        <label for="new-doc-title">{{ 'template_detail.document_title_label' | translate }}</label>
        <input pInputText id="new-doc-title" type="text" [(ngModel)]="newDocumentTitle" class="w-full" />
      </div>
      <div class="dialog-actions">
        <p-button [label]="'common.cancel' | translate" severity="secondary" (onClick)="useTemplateDialogVisible.set(false)" />
        <p-button [label]="'common.create' | translate" [loading]="creatingDocument()" [disabled]="!newDocumentTitle" (onClick)="createDocumentFromTemplate()" />
      </div>
    </p-dialog>
  `,
  styles: `
    .field {
      margin-bottom: 1rem;
    }
    .field label {
      display: block;
      margin-bottom: 0.35rem;
      font-size: 0.875rem;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
    }

    .header-content {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }

    .header-text h1 {
      margin: 0 0 0.5rem;
      font-size: 1.75rem;
      font-weight: 600;
    }

    .header-text p {
      margin: 0;
      color: var(--p-text-muted-color);
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    .content-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-item .label {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-item .value {
      font-size: 0.875rem;
      font-weight: 500;
    }

    .model-json {
      margin: 0;
      padding: 1rem;
      background: var(--p-surface-50);
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.875rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .empty-model {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem;
      color: var(--p-text-muted-color);
    }

    .empty-model i {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      text-align: center;
    }

    .not-found i {
      font-size: 4rem;
      margin-bottom: 1rem;
      color: var(--p-text-muted-color);
    }

    .not-found h2 {
      margin: 0 0 1rem;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }

    .loading-state i {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
  `,
})
export class TemplateDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly templateService = inject(TemplateService);
  private readonly documentService = inject(DocumentService);

  protected readonly template = signal<Template | undefined>(undefined);
  protected readonly loading = signal<boolean>(true);
  protected readonly confirming = signal(false);
  protected readonly useTemplateDialogVisible = signal(false);
  protected readonly creatingDocument = signal(false);
  protected newDocumentTitle = '';

  protected readonly Visibility = Visibility;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadTemplate(id);
    }
  }

  private async loadTemplate(id: string): Promise<void> {
    this.loading.set(true);
    const template = await this.templateService.getById(id);
    this.template.set(template);
    this.loading.set(false);
  }

  async confirmTemplate(): Promise<void> {
    const id = this.template()?.id;
    if (!id) return;
    this.confirming.set(true);
    try {
      const confirmed = await this.templateService.confirm(id);
      if (confirmed) this.template.set(confirmed);
    } finally {
      this.confirming.set(false);
    }
  }

  openUseTemplateDialog(): void {
    this.newDocumentTitle = this.template()?.name ?? '';
    this.useTemplateDialogVisible.set(true);
  }

  async createDocumentFromTemplate(): Promise<void> {
    const t = this.template();
    if (!t || !this.newDocumentTitle) return;
    this.creatingDocument.set(true);
    try {
      const docId = await this.documentService.createAndGetId(
        this.newDocumentTitle,
        t.id,
        t.currentVersion
      );
      await this.router.navigate(['/documents', docId]);
    } catch (err) {
      console.error('Failed to create document from template', err);
    } finally {
      this.creatingDocument.set(false);
    }
  }

  getReportTypeLabel(type: ReportType): string {
    return getReportTypeLabel(type);
  }

  getReportTypeSeverity(
    type: ReportType
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    return getReportTypeSeverity(type);
  }

  getVisibilityLabel(visibility: Visibility): string {
    return getVisibilityLabel(visibility);
  }

  formatDate(ts?: { seconds: bigint; nanos: number }): Date | undefined {
    return timestampToDate(ts);
  }
}
