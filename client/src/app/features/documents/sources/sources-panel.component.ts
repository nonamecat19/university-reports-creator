import { Component, EventEmitter, inject, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import {
  type CslJson,
  formatAuthors,
  type ParsedSource,
  SOURCE_TYPES,
  SourceService,
  sourceYear,
} from '../../../core/services/source.service';

/** Draft the entry form edits before anything is saved (FR-BIB-04: resolver
 * output always lands in the form for confirmation, never straight in the DB). */
interface SourceDraft {
  id: string;
  type: string;
  title: string;
  authors: string;
  containerTitle: string;
  publisher: string;
  place: string;
  year: string;
  page: string;
  volume: string;
  issue: string;
  doi: string;
  isbn: string;
  url: string;
  accessDate: string;
  language: string;
  fillStatus: string;
  rawInput: string;
}

function emptyDraft(): SourceDraft {
  return {
    id: '',
    type: 'book',
    title: '',
    authors: '',
    containerTitle: '',
    publisher: '',
    place: '',
    year: '',
    page: '',
    volume: '',
    issue: '',
    doi: '',
    isbn: '',
    url: '',
    accessDate: '',
    language: 'uk',
    fillStatus: 'manual',
    rawInput: '',
  };
}

/**
 * Source library + bibliography preview panel (FR-BIB-01..11), the "sources"
 * tab of the editor's right sidebar. Insertion of a citation is delegated
 * upward: the panel knows the sources, the editor owns the selection.
 */
@Component({
  selector: 'app-sources-panel',
  standalone: true,
  imports: [FormsModule, TranslatePipe, Button, Dialog, InputText, Select, Tag],
  template: `
    <div class="sources-panel">
      <div class="panel-header">
        <h3>{{ 'sources.title' | translate }}</h3>
        <p-button icon="pi pi-plus" size="small" [text]="true" (onClick)="openNew()" />
      </div>

      <div class="autofill">
        <input
          pInputText
          type="text"
          [(ngModel)]="autofillInput"
          [placeholder]="'sources.autofill_placeholder' | translate"
          (keydown.enter)="runAutofill()"
        />
        <p-button
          icon="pi pi-search"
          size="small"
          [loading]="resolving()"
          [disabled]="!autofillInput"
          (onClick)="runAutofill()"
        />
      </div>
      @if (resolveWarning()) {
        <p class="resolve-warning">{{ resolveWarning() }}</p>
      }

      @if (sourceService.hasOrphans()) {
        <p class="orphan-warning">
          {{ 'sources.orphans' | translate: { count: sourceService.orphanedCitationIds().length } }}
        </p>
      }

      <ul class="source-list">
        @for (source of sourceService.sources(); track source.id) {
          <li class="source-row">
            <div class="source-main" (click)="openEdit(source)">
              <span class="source-number">{{ numberFor(source.id) }}</span>
              <span class="source-text">
                <strong>{{ source.csl.title || ('sources.untitled' | translate) }}</strong>
                <span class="source-meta">{{ authorsOf(source) }} {{ yearOf(source) }}</span>
              </span>
            </div>
            <div class="source-actions">
              @if (source.fillStatus === 'needs_review') {
                <p-tag severity="warn" [value]="'sources.needs_review' | translate" />
              }
              <p-button
                icon="pi pi-bookmark"
                size="small"
                [text]="true"
                [title]="'sources.cite' | translate"
                (onClick)="cite.emit(source.id)"
              />
              <p-button
                icon="pi pi-trash"
                size="small"
                [text]="true"
                severity="danger"
                (onClick)="remove(source)"
              />
            </div>
          </li>
        } @empty {
          <li class="empty">{{ 'sources.empty' | translate }}</li>
        }
      </ul>

      <div class="bibliography">
        <h4>{{ 'sources.bibliography' | translate }}</h4>
        <ol class="bib-list">
          @for (entry of sourceService.entries(); track entry.sourceId) {
            <li>{{ entry.formatted }}</li>
          } @empty {
            <li class="empty">{{ 'sources.bibliography_empty' | translate }}</li>
          }
        </ol>
      </div>
    </div>

    <p-dialog
      [header]="'sources.form_title' | translate"
      [(visible)]="formVisible"
      [modal]="true"
      [style]="{ width: '34rem' }"
    >
      <div class="form-grid">
        <div class="field">
          <label for="src-type">{{ 'sources.field.type' | translate }}</label>
          <p-select
            id="src-type"
            [options]="typeOptions"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="draft.type"
          />
        </div>
        <div class="field span-2">
          <label for="src-title">{{ 'sources.field.title' | translate }}</label>
          <input pInputText id="src-title" type="text" [(ngModel)]="draft.title" />
        </div>
        <div class="field span-2">
          <label for="src-authors">{{ 'sources.field.authors' | translate }}</label>
          <input
            pInputText
            id="src-authors"
            type="text"
            [(ngModel)]="draft.authors"
            [placeholder]="'sources.authors_hint' | translate"
          />
        </div>
        <div class="field span-2">
          <label for="src-container">{{ 'sources.field.container' | translate }}</label>
          <input pInputText id="src-container" type="text" [(ngModel)]="draft.containerTitle" />
        </div>
        <div class="field">
          <label for="src-place">{{ 'sources.field.place' | translate }}</label>
          <input pInputText id="src-place" type="text" [(ngModel)]="draft.place" />
        </div>
        <div class="field">
          <label for="src-publisher">{{ 'sources.field.publisher' | translate }}</label>
          <input pInputText id="src-publisher" type="text" [(ngModel)]="draft.publisher" />
        </div>
        <div class="field">
          <label for="src-year">{{ 'sources.field.year' | translate }}</label>
          <input pInputText id="src-year" type="text" [(ngModel)]="draft.year" />
        </div>
        <div class="field">
          <label for="src-page">{{ 'sources.field.page' | translate }}</label>
          <input pInputText id="src-page" type="text" [(ngModel)]="draft.page" />
        </div>
        <div class="field">
          <label for="src-volume">{{ 'sources.field.volume' | translate }}</label>
          <input pInputText id="src-volume" type="text" [(ngModel)]="draft.volume" />
        </div>
        <div class="field">
          <label for="src-issue">{{ 'sources.field.issue' | translate }}</label>
          <input pInputText id="src-issue" type="text" [(ngModel)]="draft.issue" />
        </div>
        <div class="field">
          <label for="src-doi">DOI</label>
          <input pInputText id="src-doi" type="text" [(ngModel)]="draft.doi" />
        </div>
        <div class="field">
          <label for="src-isbn">ISBN</label>
          <input pInputText id="src-isbn" type="text" [(ngModel)]="draft.isbn" />
        </div>
        <div class="field span-2">
          <label for="src-url">URL</label>
          <input pInputText id="src-url" type="text" [(ngModel)]="draft.url" />
        </div>
        <div class="field">
          <label for="src-access">{{ 'sources.field.access_date' | translate }}</label>
          <input pInputText id="src-access" type="date" [(ngModel)]="draft.accessDate" />
        </div>
        <div class="field">
          <label for="src-language">{{ 'sources.field.language' | translate }}</label>
          <p-select
            id="src-language"
            [options]="languageOptions"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="draft.language"
          />
        </div>
      </div>

      @if (formError()) {
        <p class="resolve-warning">{{ formError() }}</p>
      }

      <div class="dialog-actions">
        <p-button
          label="{{ 'common.cancel' | translate }}"
          severity="secondary"
          (onClick)="formVisible.set(false)"
        />
        <p-button
          label="{{ 'common.save' | translate }}"
          [loading]="saving()"
          [disabled]="!draft.title"
          (onClick)="save()"
        />
      </div>
    </p-dialog>
  `,
  styles: `
    .sources-panel { display: flex; flex-direction: column; gap: 0.75rem; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; }
    .panel-header h3 { margin: 0; font-size: 0.95rem; }
    .autofill { display: flex; gap: 0.35rem; }
    .autofill input { flex: 1; min-width: 0; font-size: 0.8rem; }
    .resolve-warning, .orphan-warning {
      font-size: 0.75rem;
      color: var(--p-orange-600, #d97706);
      margin: 0;
    }
    .orphan-warning { color: var(--p-red-500, #ef4444); }
    .source-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .source-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.35rem;
      border: 1px solid var(--p-content-border-color, #dcdfe4);
      border-radius: 6px;
      padding: 0.4rem 0.5rem;
    }
    .source-main { display: flex; gap: 0.4rem; cursor: pointer; min-width: 0; }
    .source-number { font-weight: 600; color: var(--p-text-muted-color, #6b7280); font-size: 0.8rem; }
    .source-text { display: flex; flex-direction: column; min-width: 0; font-size: 0.8rem; }
    .source-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .source-meta { color: var(--p-text-muted-color, #6b7280); font-size: 0.72rem; }
    .source-actions { display: flex; align-items: center; gap: 0.15rem; }
    .empty { font-size: 0.78rem; color: var(--p-text-muted-color, #6b7280); }
    .bibliography h4 { margin: 0.5rem 0 0.25rem; font-size: 0.85rem; }
    .bib-list { margin: 0; padding-left: 1.1rem; font-size: 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; }
    .form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
    .field { display: flex; flex-direction: column; gap: 0.2rem; }
    .field.span-2 { grid-column: span 2; }
    .field label { font-size: 0.75rem; color: var(--p-text-muted-color, #6b7280); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  `,
})
export class SourcesPanelComponent {
  /** Emitted when the user asks to cite a source; the editor inserts the node
   * at its own cursor (FR-BIB-05). */
  @Output() cite = new EventEmitter<string>();

  protected readonly sourceService = inject(SourceService);

  protected autofillInput = '';
  protected draft: SourceDraft = emptyDraft();
  protected readonly formVisible = signal(false);
  protected readonly resolving = signal(false);
  protected readonly saving = signal(false);
  protected readonly resolveWarning = signal('');
  protected readonly formError = signal('');

  protected readonly typeOptions = SOURCE_TYPES.map((t) => ({ value: t.value, label: t.labelKey }));
  protected readonly languageOptions = [
    { value: 'uk', label: 'Українська' },
    { value: 'en', label: 'English' },
    { value: 'other', label: 'Інша' },
  ];

  numberFor(sourceId: string): string {
    const number = this.sourceService.citationNumbers().get(sourceId);
    return number ? `${number}.` : '—';
  }

  authorsOf(source: ParsedSource): string {
    return formatAuthors(source.csl);
  }

  yearOf(source: ParsedSource): string {
    return sourceYear(source.csl);
  }

  openNew(): void {
    this.draft = emptyDraft();
    this.formError.set('');
    this.formVisible.set(true);
  }

  openEdit(source: ParsedSource): void {
    this.draft = draftFromCsl(source);
    this.formError.set('');
    this.formVisible.set(true);
  }

  /** FR-BIB-04: resolved metadata lands in the form for confirmation. */
  async runAutofill(): Promise<void> {
    const input = this.autofillInput.trim();
    if (!input) return;
    this.resolving.set(true);
    this.resolveWarning.set('');
    try {
      const result = await this.sourceService.resolve(input);
      if (result.warning) this.resolveWarning.set(result.warning);
      this.draft = result.csl
        ? { ...draftFromRawCsl(result.csl), fillStatus: result.fillStatus, rawInput: input }
        : { ...emptyDraft(), fillStatus: 'needs_review', rawInput: input, url: input };
      this.formVisible.set(true);
      this.autofillInput = '';
    } catch (error) {
      this.resolveWarning.set(String(error));
    } finally {
      this.resolving.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.formError.set('');
    try {
      const csl = cslFromDraft(this.draft);
      // Once the user has reviewed and saved, the entry is confirmed —
      // `needs_review` never survives an explicit save (FR-BIB-02).
      const fillStatus = this.draft.fillStatus === 'auto' ? 'auto' : 'manual';
      if (this.draft.id) {
        await this.sourceService.update(
          this.draft.id,
          csl,
          this.draft.language,
          fillStatus,
          this.draft.accessDate
        );
      } else {
        await this.sourceService.add(
          csl,
          this.draft.language,
          this.draft.rawInput,
          fillStatus,
          this.draft.accessDate
        );
      }
      this.formVisible.set(false);
    } catch (error) {
      this.formError.set(String(error));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(source: ParsedSource): Promise<void> {
    await this.sourceService.remove(source.id);
  }
}

function draftFromCsl(source: ParsedSource): SourceDraft {
  return {
    ...draftFromRawCsl(source.csl),
    id: source.id,
    language: source.language || 'uk',
    fillStatus: source.fillStatus || 'manual',
    accessDate: source.accessDate || '',
    rawInput: source.rawInput || '',
  };
}

function draftFromRawCsl(csl: CslJson): SourceDraft {
  const draft = emptyDraft();
  draft.type = csl.type ?? 'book';
  draft.title = csl.title ?? '';
  draft.authors = (csl.author ?? [])
    .map((a) => a.literal ?? [a.family, a.given].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('; ');
  draft.containerTitle = csl['container-title'] ?? '';
  draft.publisher = csl.publisher ?? '';
  draft.place = csl['publisher-place'] ?? '';
  draft.year = String(csl.issued?.['date-parts']?.[0]?.[0] ?? '');
  draft.page = csl.page ?? '';
  draft.volume = csl.volume ?? '';
  draft.issue = csl.issue ?? '';
  draft.doi = csl.DOI ?? '';
  draft.isbn = csl.ISBN ?? '';
  draft.url = csl.URL ?? '';
  return draft;
}

function cslFromDraft(draft: SourceDraft): CslJson {
  const csl: CslJson = { type: draft.type, title: draft.title.trim() };

  const authors = draft.authors
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const [family, given] = name.split(',').map((part) => part.trim());
      return given ? { family, given } : { literal: family };
    });
  if (authors.length) csl.author = authors;

  const year = Number.parseInt(draft.year, 10);
  if (!Number.isNaN(year)) csl.issued = { 'date-parts': [[year]] };

  // Empty strings are dropped rather than stored: citeproc treats a present
  // empty field differently from an absent one when applying punctuation.
  const optional: [keyof CslJson, string][] = [
    ['container-title', draft.containerTitle],
    ['publisher', draft.publisher],
    ['publisher-place', draft.place],
    ['page', draft.page],
    ['volume', draft.volume],
    ['issue', draft.issue],
    ['DOI', draft.doi],
    ['ISBN', draft.isbn],
    ['URL', draft.url],
  ];
  for (const [key, value] of optional) {
    if (value.trim()) csl[key] = value.trim();
  }

  if (draft.accessDate) {
    const [y, m, d] = draft.accessDate.split('-').map((n) => Number.parseInt(n, 10));
    if (y) csl['accessed'] = { 'date-parts': [[y, m, d].filter((n) => !Number.isNaN(n))] };
  }

  return csl;
}
