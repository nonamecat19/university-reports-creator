import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ReportType, TemplateFilter, Visibility } from '@gen/template/template';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { FileService, Purpose } from '../../core/services/file.service';
import { getReportTypeLabel, getReportTypeSeverity } from '../../shared/models/template.model';
import { TemplateService } from './template.service';

@Component({
  selector: 'app-templates-list',
  imports: [FormsModule, RouterLink, Card, Button, Dialog, InputText, Select, Tag, TranslatePipe],
  template: `
    <div class="page-header">
      <div class="header-content">
        <h1>{{ 'templates.title' | translate }}</h1>
        <p>{{ 'templates.subtitle' | translate }}</p>
      </div>
      <p-button
        [label]="'templates.new_template' | translate"
        icon="pi pi-plus"
        severity="primary"
        (onClick)="openUploadDialog()"
      />
    </div>

    <div class="filters">
      <span class="p-input-icon-left">
        <i class="pi pi-search"></i>
        <input
          pInputText
          [ngModel]="searchQuery()"
          (ngModelChange)="searchQuery.set($event)"
          [placeholder]="'templates.search_placeholder' | translate"
          data-testid="templates-search-input"
        />
      </span>
      <p-select
        [ngModel]="selectedReportType()"
        [options]="reportTypeOptions"
        [placeholder]="'templates.all_types' | translate"
        (ngModelChange)="selectedReportType.set($event)"
        data-testid="templates-type-filter"
      />
    </div>

    @if (templateService.isLoading()) {
      <div class="loading-state">
        <i class="pi pi-spinner pi-spin"></i>
        <p>{{ 'templates.loading' | translate }}</p>
      </div>
    } @else if (templateService.error()) {
      <div class="error-state">
        <i class="pi pi-exclamation-triangle"></i>
        <p>{{ templateService.error() }}</p>
      </div>
    } @else {
      <div class="templates-grid" data-testid="templates-grid">
        @for (template of filteredTemplates(); track template.id) {
          <p-card styleClass="template-card" data-testid="templates-card">
            <ng-template #title>{{ template.name }}</ng-template>
            <ng-template #subtitle>
              <p-tag
                [value]="getReportTypeLabel(template.reportType) | translate"
                [severity]="getReportTypeSeverity(template.reportType)"
              />
            </ng-template>

            <p class="description">{{ template.description }}</p>

            <div class="template-meta">
              <div class="meta-item">
                <i class="pi pi-file"></i>
                <span>{{ 'templates.version' | translate: { version: template.currentVersion } }}</span>
              </div>
              @if (template.visibility === Visibility.PUBLIC) {
                <div class="meta-item">
                  <i class="pi pi-globe"></i>
                  <span>{{ 'templates.public' | translate }}</span>
                </div>
              } @else {
                <div class="meta-item">
                  <i class="pi pi-lock"></i>
                  <span>{{ 'templates.private' | translate }}</span>
                </div>
              }
            </div>

            <ng-template #footer>
              <div class="card-actions">
                <p-button
                  [label]="'templates.view' | translate"
                  severity="secondary"
                  [outlined]="true"
                  [routerLink]="['/templates', template.id]"
                  data-testid="templates-view-btn"
                />
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [text]="true"
                  (onClick)="deleteTemplate(template.id)"
                  data-testid="templates-delete-btn"
                />
              </div>
            </ng-template>
          </p-card>
        } @empty {
          <div class="empty-state">
            <i class="pi pi-file"></i>
            <h3>{{ 'templates.no_templates_found' | translate }}</h3>
            <p>{{ 'templates.try_adjusting' | translate }}</p>
          </div>
        }
      </div>
    }

    <p-dialog [header]="'templates.upload_dialog' | translate" [(visible)]="uploadDialogVisible" [modal]="true" [style]="{ width: '30rem' }">
      <div class="field">
        <label for="upload-name">{{ 'templates.name_label' | translate }}</label>
        <input pInputText id="upload-name" type="text" [(ngModel)]="newName" class="w-full" />
      </div>
      <div class="field">
        <label for="upload-description">{{ 'templates.description_label' | translate }}</label>
        <input pInputText id="upload-description" type="text" [(ngModel)]="newDescription" class="w-full" />
      </div>
      <div class="field">
        <label for="upload-report-type">{{ 'templates.report_type_label' | translate }}</label>
        <p-select id="upload-report-type" [options]="reportTypeOptions" optionLabel="label" optionValue="value" [(ngModel)]="newReportType" class="w-full" />
      </div>
      <div class="field">
        <label>{{ 'templates.file_label' | translate }}</label>
        <p-button [label]="selectedFileName() || ('templates.choose_file' | translate)" icon="pi pi-upload" severity="secondary" [outlined]="true" (onClick)="fileInput.click()" />
        <input #fileInput type="file" accept=".docx,.doc" hidden (change)="onFilePicked($event)" />
      </div>
      @if (uploadError()) {
        <p class="upload-error">{{ uploadError() }}</p>
      }
      <div class="dialog-actions">
        <p-button [label]="'common.cancel' | translate" severity="secondary" (onClick)="uploadDialogVisible.set(false)" />
        <p-button [label]="'templates.create' | translate" [loading]="uploading()" [disabled]="!newName || !selectedFile()" (onClick)="submitUpload()" />
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
    .upload-error {
      color: var(--p-red-500);
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

    .header-content h1 {
      margin: 0 0 0.5rem;
      font-size: 1.75rem;
      font-weight: 600;
    }

    .header-content p {
      margin: 0;
      color: var(--p-text-muted-color);
    }

    .filters {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .filters span {
      display: flex;
      align-items: center;
    }

    .filters input {
      width: 300px;
    }

    .templates-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
    }

    :host ::ng-deep .template-card {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .description {
      margin: 0 0 1rem;
      color: var(--p-text-secondary-color);
      font-size: 0.875rem;
      flex: 1;
    }

    .template-meta {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--p-surface-border);
      margin-bottom: 0.5rem;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--p-text-muted-color);
    }

    .meta-item i {
      font-size: 0.875rem;
    }

    .card-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }

    .empty-state i {
      font-size: 4rem;
      margin-bottom: 1rem;
    }

    .empty-state h3 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 500;
    }

    .empty-state p {
      margin: 0;
    }

    .loading-state, .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }

    .loading-state i, .error-state i {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    .error-state {
      color: var(--p-red-500);
    }
  `,
})
export class TemplatesListComponent implements OnInit {
  readonly templateService = inject(TemplateService);
  private readonly translate = inject(TranslateService);
  private readonly fileService = inject(FileService);
  private readonly router = inject(Router);

  protected readonly uploadDialogVisible = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly selectedFileName = computed(() => this.selectedFile()?.name ?? '');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected newName = '';
  protected newDescription = '';
  protected newReportType: ReportType = ReportType.DIPLOMA;

  protected readonly searchQuery = signal('');
  protected readonly selectedReportType = signal<ReportType | null>(null);

  protected readonly filteredTemplates = computed(() => {
    let templates = this.templateService.templates();

    const query = this.searchQuery().toLowerCase();
    if (query) {
      templates = templates.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      );
    }

    const reportType = this.selectedReportType();
    if (reportType !== null) {
      templates = templates.filter((t) => t.reportType === reportType);
    }

    return templates;
  });

  protected readonly Visibility = Visibility;

  protected readonly reportTypeOptions = [
    { label: this.translate.instant('templates.report_type.course'), value: ReportType.COURSE },
    { label: this.translate.instant('templates.report_type.diploma'), value: ReportType.DIPLOMA },
    { label: this.translate.instant('templates.report_type.practice'), value: ReportType.PRACTICE },
    { label: this.translate.instant('templates.report_type.other'), value: ReportType.OTHER },
  ];

  ngOnInit(): void {
    this.templateService.list(TemplateFilter.OWN);
  }

  getReportTypeLabel(type: ReportType): string {
    return getReportTypeLabel(type);
  }

  getReportTypeSeverity(
    type: ReportType
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    return getReportTypeSeverity(type);
  }

  deleteTemplate(id: string): void {
    this.templateService.remove(id);
  }

  openUploadDialog(): void {
    this.newName = '';
    this.newDescription = '';
    this.newReportType = ReportType.DIPLOMA;
    this.selectedFile.set(null);
    this.uploadError.set(null);
    this.uploadDialogVisible.set(true);
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  async submitUpload(): Promise<void> {
    const file = this.selectedFile();
    if (!file || !this.newName) return;

    this.uploading.set(true);
    this.uploadError.set(null);
    try {
      const uploaded = await this.fileService.upload(file, Purpose.TEMPLATES);
      const { template } = await this.templateService.create(
        this.newName,
        this.newDescription,
        this.newReportType,
        uploaded.id
      );
      if (!template) {
        this.uploadError.set(this.translate.instant('templates.upload_failed'));
        return;
      }
      this.uploadDialogVisible.set(false);
      await this.router.navigate(['/templates', template.id]);
    } catch (err) {
      console.error('Template upload failed', err);
      this.uploadError.set(this.translate.instant('templates.upload_failed'));
    } finally {
      this.uploading.set(false);
    }
  }
}
