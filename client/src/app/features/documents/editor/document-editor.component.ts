import { CdkDrag, type CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { DatePipe } from '@angular/common';
import {
  Component,
  HostListener,
  Input,
  inject,
  type OnInit,
  type QueryList,
  signal,
  ViewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { AuthService } from '../../../core/services/auth.service';
import {
  type Document,
  DocumentService,
  type ExportJobStatus,
  type Section,
  SectionKind,
  type SnapshotSummary,
  type TableContinuation,
} from '../../../core/services/document.service';
import { FileService } from '../../../core/services/file.service';
import { ReviewService } from '../../../core/services/review.service';
import { SourceService } from '../../../core/services/source.service';
import { AiTabComponent } from '../../ai/ai-tab.component';
import { ReviewPanelComponent, type SuggestionResolution } from '../review/review-panel.component';
import { ShareDialogComponent } from '../review/share-dialog.component';
import { SourcesPanelComponent } from '../sources/sources-panel.component';
import { hydrateImages, parseSectionContent } from './document-content.util';
import {
  captionText,
  collectReferenceTargets,
  computeNumbering,
  type NumberingInput,
  type PMNode,
  type ReferenceTarget,
  referenceLabels,
} from './numbering';
import {
  collectSuggestionIds,
  resolveAllSuggestionsInDoc,
  resolveSuggestionInDoc,
} from './schema/suggest-mode.extension';
import { SectionEditorComponent } from './section-editor.component';
import { countWords, estimatePages } from './word-count';

type SaveStatus = 'saved' | 'saving' | 'error';

const WELL_KNOWN_METADATA_FIELDS = [
  'student_name',
  'university',
  'faculty',
  'department',
  'group',
  'supervisor',
  'topic',
  'city',
  'year',
] as const;

const METADATA_DEBOUNCE_MS = 2000;

@Component({
  selector: 'app-document-editor',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TranslatePipe,
    Button,
    Dialog,
    InputText,
    Select,
    Tag,
    Tooltip,
    CdkDropList,
    CdkDrag,
    AiTabComponent,
    SourcesPanelComponent,
    ReviewPanelComponent,
    ShareDialogComponent,
    SectionEditorComponent,
  ],
  template: `
    @if (loading()) {
      <div class="state-message">{{ 'editor.loading' | translate }}</div>
    } @else if (!doc()) {
      <div class="state-message">{{ 'editor.not_found' | translate }}</div>
    } @else {
      <div class="document-editor">
        <aside class="outline">
          <div class="outline-header">
            <h3>{{ 'editor.outline_title' | translate }}</h3>
            <p-button icon="pi pi-plus" size="small" [text]="true" (onClick)="openAddSection()" [pTooltip]="'editor.add_section' | translate" />
          </div>
          <div class="outline-summary">
            {{ 'editor.word_count' | translate: { count: totalWordCount() } }}
            · {{ 'editor.page_estimate' | translate: { count: totalPageEstimate() } }}
          </div>
          <div cdkDropList class="outline-list" (cdkDropListDropped)="onReorder($event)">
            @for (section of sections(); track section.id) {
              <div cdkDrag class="outline-item" (click)="scrollTo(section.id)">
                <i class="pi pi-bars drag-handle"></i>
                <span class="outline-label">{{ sectionLabel(section) }}</span>
                <span class="outline-title">{{ section.title }}</span>
                @if (statusFor(section.id) === 'saving') {
                  <i class="pi pi-spin pi-spinner outline-status"></i>
                } @else if (statusFor(section.id) === 'error') {
                  <i class="pi pi-exclamation-triangle outline-status status-error"></i>
                }
              </div>
            }
          </div>
        </aside>

        <main class="editor-main">
          <div class="metadata-panel">
            <div class="metadata-header" (click)="metadataOpen.set(!metadataOpen())">
              <h3>{{ doc()!.title }}</h3>
              <div class="metadata-status">
                @if (metadataStatus() === 'saving') {
                  <span class="status status-saving">{{ 'editor.status.saving' | translate }}</span>
                } @else if (metadataStatus() === 'error') {
                  <span class="status status-error">{{ 'editor.status.error' | translate }}</span>
                } @else {
                  <span class="status status-saved">{{ 'editor.status.saved' | translate }}</span>
                }
                <p-button
                  [label]="'editor.versions' | translate"
                  icon="pi pi-history"
                  size="small"
                  severity="secondary"
                  (onClick)="$event.stopPropagation(); openVersionsDialog()"
                />
                <p-button
                  [label]="'editor.export' | translate"
                  icon="pi pi-file-export"
                  size="small"
                  (onClick)="$event.stopPropagation(); openExportDialog()"
                />
                <i class="pi" [class.pi-chevron-down]="!metadataOpen()" [class.pi-chevron-up]="metadataOpen()"></i>
              </div>
            </div>
            @if (metadataOpen()) {
              <div class="metadata-grid">
                @for (field of metadataFields; track field) {
                  <div class="field">
                    <label [for]="'meta-' + field">{{ 'editor.metadata.' + field | translate }}</label>
                    <input
                      pInputText
                      [id]="'meta-' + field"
                      type="text"
                      [ngModel]="metadataValues()[field] ?? ''"
                      (ngModelChange)="onMetadataChange(field, $event)"
                    />
                  </div>
                }
              </div>
            }
          </div>

          @for (section of sections(); track section.id) {
            <section class="section-block" [id]="'section-' + section.id">
              <div class="section-header">
                <h4>{{ sectionLabel(section) }} — {{ section.title }}</h4>
                <div class="section-header-actions">
                  @if (section.required && isSectionEmpty(section.id)) {
                    <p-tag severity="warn" [value]="'editor.required_empty' | translate" />
                  }
                  <span class="word-count">{{ wordCountFor(section.id) }} · ~{{ pageEstimateFor(section.id) }}</span>
                  @if (statusFor(section.id) === 'saving') {
                    <span class="status status-saving">{{ 'editor.status.saving' | translate }}</span>
                  } @else if (statusFor(section.id) === 'error') {
                    <button type="button" class="retry-btn" (click)="retrySave(section.id)">
                      {{ 'editor.status.retry' | translate }}
                    </button>
                  } @else {
                    <span class="status status-saved">{{ 'editor.status.saved' | translate }}</span>
                  }
                  @if (!section.required) {
                    <p-button icon="pi pi-trash" size="small" [text]="true" severity="danger" (onClick)="removeSection(section)" />
                  }
                </div>
              </div>
              @if (sectionContent()[section.id]) {
                <app-section-editor
                  [attr.data-section-id]="section.id"
                  [initialContent]="sectionContent()[section.id]"
                  [numberingMap]="numbering().blockNumbers"
                  [citationNumbers]="sourceService.citationNumbers()"
                  [referenceLabels]="referenceLabels()"
                  [suggestMode]="suggestMode()"
                  [authorId]="currentUserId()"
                  [editable]="review.canComment()"
                  (dirty)="onSectionDirty(section.id, $event)"
                  (save)="onSectionSave(section.id, $event)"
                  (focused)="activeSectionId.set(section.id)"
                  (requestCitation)="focusSourcesPanel(section.id)"
                  (requestCrossReference)="openCrossReferencePicker(section.id)"
                />
              }
            </section>
          }
        </main>

        <aside class="side-panel">
          <div class="panel-tabs">
            <button
              type="button"
              class="panel-tab"
              [class.active]="sidePanelTab() === 'sources'"
              (click)="sidePanelTab.set('sources')"
            >
              {{ 'sources.tab' | translate }}
            </button>
            <button
              type="button"
              class="panel-tab"
              [class.active]="sidePanelTab() === 'review'"
              (click)="openReviewTab()"
            >
              {{ 'review.tab' | translate }}
              @if (review.unreadComments() + review.unreadSuggestions() > 0) {
                <span class="badge">{{ review.unreadComments() + review.unreadSuggestions() }}</span>
              }
            </button>
            <button
              type="button"
              class="panel-tab"
              [class.active]="sidePanelTab() === 'ai'"
              (click)="sidePanelTab.set('ai')"
            >
              {{ 'ai.tab' | translate }}
            </button>
          </div>
          @if (sidePanelTab() === 'sources') {
            <app-sources-panel (cite)="insertCitation($event)" />
          } @else if (sidePanelTab() === 'review') {
            <app-review-panel
              [suggestMode]="suggestMode()"
              (addComment)="commentOnSelection()"
              (openShare)="shareVisible.set(true)"
              (toggleSuggestMode)="suggestMode.set(!suggestMode())"
              (focusComment)="scrollToSection($event.sectionId)"
              (resolveSuggestion)="applySuggestionResolution($event)"
              (bulkResolve)="applyBulkResolution($event)"
            />
          } @else {
            <app-ai-tab />
          }
        </aside>
      </div>
    }

    <app-share-dialog [documentId]="id" [(visible)]="shareVisible" />

    <p-dialog [header]="'editor.add_section_dialog' | translate" [(visible)]="addSectionVisible" [modal]="true" [style]="{ width: '28rem' }">
      <div class="field">
        <label for="new-section-title">{{ 'editor.section_title_label' | translate }}</label>
        <input pInputText id="new-section-title" type="text" [(ngModel)]="newSectionTitle" class="w-full" />
      </div>
      <div class="field">
        <label for="new-section-kind">{{ 'editor.section_kind_label' | translate }}</label>
        <p-select
          id="new-section-kind"
          [options]="sectionKindOptions"
          optionLabel="label"
          optionValue="value"
          [(ngModel)]="newSectionKind"
          class="w-full"
        />
      </div>
      <div class="dialog-actions">
        <p-button label="{{ 'common.cancel' | translate }}" severity="secondary" (onClick)="addSectionVisible.set(false)" />
        <p-button label="{{ 'common.create' | translate }}" [disabled]="!newSectionTitle" (onClick)="confirmAddSection()" />
      </div>
    </p-dialog>

    <p-dialog [header]="'editor.versions_dialog' | translate" [(visible)]="versionsVisible" [modal]="true" [style]="{ width: '34rem' }">
      <div class="version-create">
        <input pInputText type="text" [(ngModel)]="newVersionName" [placeholder]="'editor.version_name_placeholder' | translate" class="w-full" />
        <p-button [label]="'editor.save_version' | translate" [loading]="savingVersion()" (onClick)="saveVersion()" />
      </div>
      @if (versions().length === 0) {
        <p class="state-message">{{ 'editor.versions_empty' | translate }}</p>
      } @else {
        <ul class="version-list">
          @for (version of versions(); track version.id) {
            <li class="version-item">
              <div class="version-meta">
                <span class="version-name">{{ version.name || ('editor.version_trigger.' + version.trigger | translate) }}</span>
                <span class="version-sub">
                  {{ 'editor.version_trigger.' + version.trigger | translate }}
                  @if (version.createdAt) {
                    · {{ version.createdAt | date: 'dd.MM.yyyy HH:mm' }}
                  }
                </span>
              </div>
              <p-button
                [label]="'editor.restore_version' | translate"
                size="small"
                severity="secondary"
                [loading]="restoringVersionId() === version.id"
                (onClick)="restoreVersion(version)"
              />
            </li>
          }
        </ul>
      }
      <div class="dialog-actions">
        <p-button label="{{ 'common.cancel' | translate }}" severity="secondary" (onClick)="versionsVisible.set(false)" />
      </div>
    </p-dialog>

    <p-dialog [header]="'editor.cross_reference_dialog' | translate" [(visible)]="crossRefVisible" [modal]="true" [style]="{ width: '32rem' }">
      @if (crossRefTargets().length === 0) {
        <p class="state-message">{{ 'editor.cross_reference_empty' | translate }}</p>
      } @else {
        <ul class="reference-target-list">
          @for (target of crossRefTargets(); track target.id) {
            <li>
              <button type="button" class="reference-target" (click)="insertCrossReference(target.id)">
                <span class="reference-target-label">{{ target.label }}</span>
                <span class="reference-target-description">{{ target.description }}</span>
              </button>
            </li>
          }
        </ul>
      }
      <div class="dialog-actions">
        <p-button label="{{ 'common.cancel' | translate }}" severity="secondary" (onClick)="crossRefVisible.set(false)" />
      </div>
    </p-dialog>

    <p-dialog [header]="'editor.export_dialog' | translate" [(visible)]="exportVisible" [modal]="true" [style]="{ width: '28rem' }">
      @if (!exportJob()) {
        <div class="field">
          <label for="export-format">{{ 'editor.export_format_label' | translate }}</label>
          <p-select
            id="export-format"
            [options]="exportFormatOptions"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="exportFormat"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="export-table-continuation">{{ 'editor.table_continuation_label' | translate }}</label>
          <p-select
            id="export-table-continuation"
            [options]="tableContinuationOptions"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="tableContinuation"
            class="w-full"
          />
          @if (tableContinuation === 'continuation_caption') {
            <small class="field-hint">{{ 'editor.table_continuation_hint' | translate }}</small>
          }
        </div>
        <div class="dialog-actions">
          <p-button label="{{ 'common.cancel' | translate }}" severity="secondary" (onClick)="exportVisible.set(false)" />
          <p-button [label]="'editor.export' | translate" [loading]="exporting()" (onClick)="startExport()" />
        </div>
      } @else if (exportJob()!.status === 'failed') {
        <p class="upload-error">{{ exportJob()!.error }}</p>
        <div class="dialog-actions">
          <p-button label="{{ 'common.cancel' | translate }}" severity="secondary" (onClick)="exportVisible.set(false)" />
        </div>
      } @else {
        <p>{{ 'editor.export_done' | translate }}</p>
        @for (w of exportJob()!.warnings; track w) {
          <p class="export-warning">⚠ {{ w }}</p>
        }
        <ul class="artifact-list">
          @for (a of exportJob()!.artifacts; track a.fileKey) {
            <li>
              <a href="#" (click)="downloadArtifact($event, a)">{{ a.filename }}</a>
            </li>
          }
        </ul>
        <div class="dialog-actions">
          <p-button label="{{ 'common.cancel' | translate }}" severity="secondary" (onClick)="exportVisible.set(false)" />
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .state-message {
      padding: 2rem;
      text-align: center;
      color: var(--p-text-muted-color, #6b7280);
    }
    .document-editor {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr) 320px;
      gap: 1rem;
      padding: 1rem;
      align-items: start;
    }
    .outline, .side-panel {
      position: sticky;
      top: 1rem;
      background: var(--p-content-background, #fff);
      border: 1px solid var(--p-content-border-color, #dcdfe4);
      border-radius: 8px;
      padding: 0.75rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
    }
    .panel-tabs {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 0.5rem;
      border-bottom: 1px solid var(--p-content-border-color, #dcdfe4);
    }
    .panel-tab {
      border: none;
      background: transparent;
      padding: 0.4rem 0.6rem;
      cursor: pointer;
      font-size: 0.8rem;
      border-bottom: 2px solid transparent;
      color: inherit;
    }
    .badge {
      display: inline-block;
      margin-left: 0.25rem;
      min-width: 1.1rem;
      padding: 0 0.25rem;
      border-radius: 999px;
      background: var(--p-red-500, #ef4444);
      color: #fff;
      font-size: 0.65rem;
      line-height: 1.1rem;
      text-align: center;
    }
    .panel-tab.active {
      border-bottom-color: var(--p-primary-500, #3b82f6);
      color: var(--p-primary-700, #1d4ed8);
      font-weight: 600;
    }
    .outline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .outline-summary {
      font-size: 0.75rem;
      color: var(--p-text-muted-color, #6b7280);
      margin-bottom: 0.5rem;
    }
    .outline-item {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .outline-item:hover {
      background: var(--p-surface-100, #f1f3f6);
    }
    .drag-handle {
      cursor: grab;
      opacity: 0.5;
    }
    .outline-label {
      font-weight: 600;
      color: var(--p-text-muted-color, #6b7280);
    }
    .outline-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-error { color: var(--p-red-500, #ef4444); }
    .editor-main {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-width: 0;
    }
    .metadata-panel {
      border: 1px solid var(--p-content-border-color, #dcdfe4);
      border-radius: 8px;
      background: var(--p-content-background, #fff);
    }
    .metadata-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      cursor: pointer;
    }
    .metadata-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      padding: 0 1rem 1rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .field label {
      font-size: 0.8rem;
      color: var(--p-text-muted-color, #6b7280);
    }
    .field-hint {
      font-size: 0.75rem;
      color: var(--p-yellow-600, #ca8a04);
    }
    .section-block {
      scroll-margin-top: 1rem;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.4rem;
    }
    .section-header-actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .word-count {
      font-size: 0.75rem;
      color: var(--p-text-muted-color, #6b7280);
    }
    .status {
      font-size: 0.75rem;
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
    }
    .status-saved { color: var(--p-green-600, #16a34a); }
    .status-saving { color: var(--p-yellow-600, #ca8a04); }
    .retry-btn {
      font-size: 0.75rem;
      color: var(--p-red-500, #ef4444);
      background: none;
      border: none;
      cursor: pointer;
      text-decoration: underline;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .artifact-list, .reference-target-list {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0;
    }
    .reference-target-list {
      max-height: 22rem;
      overflow-y: auto;
    }
    .version-create {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .version-create input {
      flex: 1;
    }
    .version-list {
      list-style: none;
      padding: 0;
      margin: 0;
      max-height: 22rem;
      overflow-y: auto;
    }
    .version-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--p-content-border-color, #dcdfe4);
    }
    .version-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .version-name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .version-sub {
      font-size: 0.75rem;
      color: var(--p-text-muted-color, #6b7280);
    }
    .reference-target {
      display: flex;
      gap: 0.6rem;
      width: 100%;
      padding: 0.45rem 0.5rem;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      text-align: left;
      color: inherit;
      font-size: 0.85rem;
    }
    .reference-target:hover {
      background: var(--p-surface-100, #f1f3f6);
    }
    .reference-target-label {
      font-weight: 600;
      white-space: nowrap;
      color: var(--p-primary-700, #1d4ed8);
    }
    .reference-target-description {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--p-text-muted-color, #6b7280);
    }
    .artifact-list li {
      padding: 0.4rem 0;
    }
    .export-warning {
      color: var(--p-yellow-600, #ca8a04);
      font-size: 0.85rem;
      margin: 0.25rem 0;
    }
    .upload-error {
      color: var(--p-red-500, #ef4444);
      font-size: 0.875rem;
    }
  `,
})
export class DocumentEditorComponent implements OnInit {
  /** Bound from the `:id` route param via withComponentInputBinding. */
  @Input() id!: string;

  private readonly documentService = inject(DocumentService);
  private readonly authService = inject(AuthService);
  private readonly fileService = inject(FileService);
  protected readonly sourceService = inject(SourceService);
  protected readonly review = inject(ReviewService);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(true);
  readonly doc = signal<Document | null>(null);
  readonly sections = signal<Section[]>([]);
  readonly sectionContent = signal<Record<string, object>>({});
  readonly numbering = signal(computeNumbering([]));
  /** targetId -> «рис. 2.1», recomputed with the numbering (FR-EDT-07). */
  readonly referenceLabels = signal(new Map<string, string>());
  readonly crossRefVisible = signal(false);
  readonly crossRefTargets = signal<ReferenceTarget[]>([]);
  readonly versionsVisible = signal(false);
  readonly versions = signal<SnapshotSummary[]>([]);
  readonly savingVersion = signal(false);
  readonly restoringVersionId = signal('');
  readonly metadataValues = signal<Record<string, string>>({});
  readonly metadataOpen = signal(true);
  readonly metadataStatus = signal<SaveStatus>('saved');
  readonly addSectionVisible = signal(false);
  readonly exportVisible = signal(false);
  readonly exporting = signal(false);
  readonly exportJob = signal<ExportJobStatus | null>(null);
  readonly sidePanelTab = signal<'sources' | 'review' | 'ai'>('sources');
  readonly shareVisible = signal(false);
  /** Commenters are forced into suggest mode; owners/editors toggle it
   * (FR-REV-09). */
  readonly suggestMode = signal(false);
  readonly currentUserId = signal('');
  readonly commentError = signal('');
  /** Which section a panel action (cite, AI insert) applies to — the last one
   * that had focus. */
  readonly activeSectionId = signal('');

  @ViewChildren(SectionEditorComponent) sectionEditors!: QueryList<SectionEditorComponent>;

  protected readonly metadataFields = WELL_KNOWN_METADATA_FIELDS;
  protected readonly sectionKindOptions = [
    { label: 'editor.section_kind_chapter', value: SectionKind.CHAPTER },
    { label: 'editor.section_kind_appendix', value: SectionKind.APPENDIX },
  ].map((o) => ({ label: this.translate.instant(o.label), value: o.value }));
  protected readonly exportFormatOptions = [
    { label: this.translate.instant('editor.export_format_docx'), value: 'docx' as const },
    { label: this.translate.instant('editor.export_format_docx_pdf'), value: 'docx+pdf' as const },
  ];
  protected readonly tableContinuationOptions = [
    {
      label: this.translate.instant('editor.table_continuation_repeat_header'),
      value: 'repeat_header' as const,
    },
    {
      label: this.translate.instant('editor.table_continuation_caption'),
      value: 'continuation_caption' as const,
    },
  ];
  protected exportFormat: 'docx' | 'docx+pdf' = 'docx+pdf';
  protected tableContinuation: TableContinuation = 'repeat_header';
  protected newVersionName = '';
  protected newSectionTitle = '';
  protected newSectionKind: SectionKind = SectionKind.CHAPTER;

  private readonly sectionStatuses = new Map<string, SaveStatus>();
  /** Sections edited since their last successful save — what a forced flush
   * (Ctrl+S / snapshot) has to persist. */
  private readonly dirtySections = new Set<string>();
  private readonly liveSectionContent = new Map<string, PMNode>();
  private metadataTimer: ReturnType<typeof setTimeout> | null = null;
  private metadataDirty: Record<string, string> | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const { document, sections } = await this.documentService.get(this.id);
      const ordered = [...sections].sort((a, b) => a.order - b.order);
      this.doc.set(document);
      this.sections.set(ordered);
      this.metadataValues.set({ ...document.metadata });

      const contentMap: Record<string, object> = {};
      for (const section of ordered) {
        const parsed = parseSectionContent(section.contentJson);
        this.liveSectionContent.set(section.id, parsed);
        contentMap[section.id] = await hydrateImages(parsed, this.fileService);
      }
      this.sectionContent.set(contentMap);
      this.recomputeNumbering();
      this.activeSectionId.set(ordered[0]?.id ?? '');
      await this.sourceService.load(this.id);

      this.currentUserId.set(this.authService.user()?.id ?? '');
      await this.review.load(this.id, document.myRole);
      if (this.review.forcedSuggestMode()) this.suggestMode.set(true);
      await this.prefillMetadataFromProfile(document);
    } finally {
      this.loading.set(false);
    }
  }

  private async prefillMetadataFromProfile(document: Document): Promise<void> {
    const allEmpty = WELL_KNOWN_METADATA_FIELDS.every((f) => !document.metadata[f]);
    if (!allEmpty) return;
    const profile = await this.authService.getProfile();
    if (!profile) return;
    const prefill: Record<string, string> = {
      student_name: profile.name ?? '',
      university: profile.university ?? '',
      faculty: profile.faculty ?? '',
      department: profile.department ?? '',
      group: profile.studentGroup ?? '',
      supervisor: profile.supervisor ?? '',
    };
    const values = { ...this.metadataValues(), ...prefill };
    this.metadataValues.set(values);
    this.scheduleMetadataSave(values);
  }

  private numberingInput(): NumberingInput[] {
    return this.sections().map((s) => ({
      id: s.id,
      kind: s.kind === SectionKind.APPENDIX ? ('appendix' as const) : ('chapter' as const),
      order: s.order,
      title: s.title,
      content: this.liveSectionContent.get(s.id) ?? null,
    }));
  }

  private recomputeNumbering(): void {
    const result = computeNumbering(this.numberingInput());
    this.numbering.set(result);
    this.referenceLabels.set(referenceLabels(result));
  }

  sectionLabel(section: Section): string {
    const label = this.numbering().sectionLabels.get(section.id) ?? '';
    return captionText.sectionLabel(
      section.kind === SectionKind.APPENDIX ? 'appendix' : 'chapter',
      label
    );
  }

  statusFor(sectionId: string): SaveStatus {
    return this.sectionStatuses.get(sectionId) ?? 'saved';
  }

  wordCountFor(sectionId: string): string {
    const count = countWords(this.liveSectionContent.get(sectionId));
    return this.translate.instant('editor.word_count', { count });
  }

  pageEstimateFor(sectionId: string): string {
    const count = estimatePages(countWords(this.liveSectionContent.get(sectionId)));
    return this.translate.instant('editor.page_estimate', { count });
  }

  totalWordCount(): number {
    let total = 0;
    for (const section of this.sections())
      total += countWords(this.liveSectionContent.get(section.id));
    return total;
  }

  totalPageEstimate(): number {
    return estimatePages(this.totalWordCount());
  }

  isSectionEmpty(sectionId: string): boolean {
    return countWords(this.liveSectionContent.get(sectionId)) === 0;
  }

  onSectionDirty(sectionId: string, json: PMNode): void {
    this.liveSectionContent.set(sectionId, json);
    this.dirtySections.add(sectionId);
    this.recomputeNumbering();
  }

  /** Opening the review tab clears the badge counts (FR-REV-14). */
  openReviewTab(): void {
    this.sidePanelTab.set('review');
    void this.review.markRead();
  }

  scrollToSection(sectionId: string): void {
    this.scrollTo(sectionId);
  }

  /** Anchors a new comment on the current selection in the focused section
   * (FR-REV-05). */
  async commentOnSelection(): Promise<void> {
    const target = this.activeSectionEditor();
    const anchor = target?.selectionAnchor();
    if (!anchor) {
      this.commentError.set(this.translate.instant('review.select_text_first'));
      return;
    }
    const body = window.prompt(this.translate.instant('review.comment_prompt'));
    if (!body?.trim()) return;

    this.commentError.set('');
    await this.review.createComment(this.activeSectionId(), anchor, body.trim());
  }

  /** Applies an accept/reject to the section content, then persists both the
   * content and the registry row in one RPC (FR-REV-10). */
  async applySuggestionResolution(resolution: SuggestionResolution): Promise<void> {
    const section = this.sections().find((s) => s.id === resolution.sectionId);
    if (!section) return;

    const current =
      this.liveSectionContent.get(section.id) ?? parseSectionContent(section.contentJson);
    const updated = resolveSuggestionInDoc(current, resolution.suggestionId, resolution.accept);

    const { sectionRevision } = await this.review.resolveSuggestion(
      resolution.suggestionId,
      resolution.accept,
      section.id,
      JSON.stringify(updated),
      section.revision
    );
    await this.applyResolvedContent(section.id, updated as PMNode, sectionRevision);
  }

  /** Bulk accept/reject across the focused section (FR-REV-10). The server
   * snapshots first, so this stays undoable. */
  async applyBulkResolution(accept: boolean): Promise<void> {
    const section = this.sections().find((s) => s.id === this.activeSectionId());
    if (!section) return;

    const current =
      this.liveSectionContent.get(section.id) ?? parseSectionContent(section.contentJson);
    const updated = resolveAllSuggestionsInDoc(current, accept);

    const revision = await this.review.bulkResolveSuggestions(
      accept,
      section.id,
      JSON.stringify(updated),
      section.revision
    );
    await this.applyResolvedContent(section.id, updated as PMNode, revision);
  }

  private async applyResolvedContent(
    sectionId: string,
    content: PMNode,
    revision: number
  ): Promise<void> {
    this.liveSectionContent.set(sectionId, content);
    this.sections.set(
      this.sections().map((s) =>
        s.id === sectionId ? { ...s, revision, contentJson: JSON.stringify(content) } : s
      )
    );
    const editors = this.sectionEditors?.toArray() ?? [];
    const index = this.sections().findIndex((s) => s.id === sectionId);
    editors[index]?.setContent(await hydrateImages(content, this.fileService));
    this.recomputeNumbering();
  }

  private activeSectionEditor(): SectionEditorComponent | undefined {
    const editors = this.sectionEditors?.toArray() ?? [];
    const index = this.sections().findIndex((s) => s.id === this.activeSectionId());
    return editors[index >= 0 ? index : 0];
  }

  /** Toolbar "cite" button: the picker lives in the sources panel, so opening
   * that tab *is* the picker (FR-BIB-05 — type-to-search then Enter). */
  focusSourcesPanel(sectionId: string): void {
    this.activeSectionId.set(sectionId);
    this.sidePanelTab.set('sources');
  }

  /** Inserts a citation into the section that last had focus, then re-renders
   * the reference list so `by_order` numbering picks up the new occurrence
   * (FR-BIB-06). */
  async insertCitation(sourceId: string): Promise<void> {
    const editors = this.sectionEditors?.toArray() ?? [];
    const index = this.sections().findIndex((s) => s.id === this.activeSectionId());
    const target = editors[index >= 0 ? index : 0];
    if (!target) return;
    target.insertCitation(sourceId);
    target.flushNow();
    await this.sourceService.refreshBibliography();
  }

  /** Version browser (FR-EDT-10). Snapshots are full copies server-side, so
   * restoring is a server call and the editor simply reloads afterwards. */
  async openVersionsDialog(): Promise<void> {
    this.newVersionName = '';
    this.versionsVisible.set(true);
    this.versions.set(await this.documentService.listSnapshots(this.id));
  }

  async saveVersion(): Promise<void> {
    this.savingVersion.set(true);
    try {
      // Pending edits must reach the server first, or the snapshot captures the
      // last autosave rather than what the student sees.
      await this.flushDirtySections();
      await this.documentService.createSnapshot(this.id, this.newVersionName.trim());
      this.newVersionName = '';
      this.versions.set(await this.documentService.listSnapshots(this.id));
    } finally {
      this.savingVersion.set(false);
    }
  }

  async restoreVersion(version: SnapshotSummary): Promise<void> {
    const label =
      version.name || this.translate.instant(`editor.version_trigger.${version.trigger}`);
    if (!window.confirm(this.translate.instant('editor.restore_confirm', { name: label }))) return;

    this.restoringVersionId.set(version.id);
    try {
      await this.documentService.restoreSnapshot(this.id, version.id);
      this.versionsVisible.set(false);
      await this.load();
    } finally {
      this.restoringVersionId.set('');
    }
  }

  /** Ctrl+S forces a snapshot rather than a save — saves are automatic
   * (FR-EDT-09), versions are the thing a student explicitly wants to keep. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void this.saveVersion();
  }

  /** Persists every section with unsaved edits and waits for it, so a snapshot
   * taken right after captures what the student sees rather than the last
   * autosave. */
  private async flushDirtySections(): Promise<void> {
    for (const editor of this.sectionEditors?.toArray() ?? []) editor.cancelPendingSave();

    const pending = [...this.dirtySections];
    await Promise.all(
      pending.map((sectionId) => {
        const content = this.liveSectionContent.get(sectionId);
        return content ? this.onSectionSave(sectionId, content) : Promise.resolve();
      })
    );
  }

  /** Toolbar "cross-reference" button: targets are everything the document
   * currently numbers, so the picker is always in sync with the counters. */
  openCrossReferencePicker(sectionId: string): void {
    this.activeSectionId.set(sectionId);
    this.crossRefTargets.set(collectReferenceTargets(this.numberingInput(), this.numbering()));
    this.crossRefVisible.set(true);
  }

  insertCrossReference(targetId: string): void {
    this.crossRefVisible.set(false);
    const target = this.activeSectionEditor();
    if (!target) return;
    target.insertCrossReference(targetId);
    target.flushNow();
  }

  async onSectionSave(sectionId: string, json: object): Promise<void> {
    const section = this.sections().find((s) => s.id === sectionId);
    if (!section) return;
    this.sectionStatuses.set(sectionId, 'saving');
    try {
      const updated = await this.documentService.updateSection(
        this.id,
        sectionId,
        JSON.stringify(json),
        section.revision
      );
      this.sections.set(this.sections().map((s) => (s.id === sectionId ? updated : s)));
      this.sectionStatuses.set(sectionId, 'saved');
      this.dirtySections.delete(sectionId);

      // FR-REV-11: content is the source of truth for suggestions; the
      // registry is reconciled from the ids the saved content actually holds.
      const suggestionIds = collectSuggestionIds(json);
      if (suggestionIds.length > 0) {
        await this.review.registerSuggestions(
          sectionId,
          suggestionIds.map((s) => s.id),
          suggestionIds[0].kind
        );
      }
    } catch (error) {
      this.sectionStatuses.set(sectionId, 'error');
      if (error instanceof RpcError && error.code === 'FAILED_PRECONDITION') {
        // Stale revision (FR-EDT-09): another writer touched this section —
        // reload the whole document and take the server's copy of it.
        await this.load();
      } else {
        console.error('Failed to save section', sectionId, error);
      }
    }
  }

  retrySave(sectionId: string): void {
    const json = this.liveSectionContent.get(sectionId);
    if (json) void this.onSectionSave(sectionId, json);
  }

  onMetadataChange(field: string, value: string): void {
    const values = { ...this.metadataValues(), [field]: value };
    this.metadataValues.set(values);
    this.scheduleMetadataSave(values);
  }

  private scheduleMetadataSave(values: Record<string, string>): void {
    this.metadataDirty = values;
    if (this.metadataTimer) clearTimeout(this.metadataTimer);
    this.metadataTimer = setTimeout(() => this.flushMetadata(), METADATA_DEBOUNCE_MS);
  }

  private async flushMetadata(): Promise<void> {
    const values = this.metadataDirty;
    const document = this.doc();
    if (!values || !document) return;
    this.metadataDirty = null;
    this.metadataStatus.set('saving');
    try {
      const updated = await this.documentService.updateMetadata(
        this.id,
        values,
        document.metadataRevision
      );
      this.doc.set(updated);
      this.metadataStatus.set('saved');
    } catch (error) {
      this.metadataStatus.set('error');
      if (error instanceof RpcError && error.code === 'FAILED_PRECONDITION') {
        await this.load();
      } else {
        console.error('Failed to save metadata', error);
      }
    }
  }

  openAddSection(): void {
    this.newSectionTitle = '';
    this.newSectionKind = SectionKind.CHAPTER;
    this.addSectionVisible.set(true);
  }

  async confirmAddSection(): Promise<void> {
    const section = await this.documentService.addSection(
      this.id,
      this.newSectionTitle,
      this.newSectionKind,
      this.sections().length
    );
    this.sections.set([...this.sections(), section]);
    this.liveSectionContent.set(section.id, parseSectionContent(section.contentJson));
    this.sectionContent.set({
      ...this.sectionContent(),
      [section.id]: parseSectionContent(section.contentJson),
    });
    this.recomputeNumbering();
    this.addSectionVisible.set(false);
  }

  async removeSection(section: Section): Promise<void> {
    if (section.required) return;
    await this.documentService.removeSection(this.id, section.id);
    this.sections.set(this.sections().filter((s) => s.id !== section.id));
    this.liveSectionContent.delete(section.id);
    const { [section.id]: _removed, ...rest } = this.sectionContent();
    this.sectionContent.set(rest);
    this.recomputeNumbering();
  }

  async onReorder(event: CdkDragDrop<Section[]>): Promise<void> {
    const reordered = [...this.sections()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.sections.set(reordered);
    this.recomputeNumbering();
    const updated = await this.documentService.reorderSections(
      this.id,
      reordered.map((s) => s.id)
    );
    this.sections.set(updated);
    this.recomputeNumbering();
  }

  scrollTo(sectionId: string): void {
    document
      .getElementById(`section-${sectionId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openExportDialog(): void {
    this.exportJob.set(null);
    this.exportFormat = 'docx+pdf';
    this.exportVisible.set(true);
  }

  async startExport(): Promise<void> {
    this.exporting.set(true);
    try {
      const jobId = await this.documentService.exportDocument(
        this.id,
        this.exportFormat,
        this.tableContinuation
      );
      const job = await this.documentService.getExportJob(jobId);
      this.exportJob.set(job);
    } catch (error) {
      console.error('Export failed', error);
      this.exportJob.set({
        jobId: '',
        documentId: this.id,
        status: 'failed',
        stage: 'failed',
        warnings: [],
        artifacts: [],
        error: error instanceof Error ? error.message : String(error),
      } as ExportJobStatus);
    } finally {
      this.exporting.set(false);
    }
  }

  async downloadArtifact(
    event: Event,
    artifact: { fileKey: string; filename: string }
  ): Promise<void> {
    event.preventDefault();
    const url = await this.fileService.downloadAsObjectUrl(artifact.fileKey);
    const link = document.createElement('a');
    link.href = url;
    link.download = artifact.filename;
    link.click();
  }
}
