import { computed, Injectable, inject, signal } from '@angular/core';
import type { BibliographyEntry, Source } from '@gen/document/document';
import { DocumentServiceClient } from '@gen/document/document.client';
import { grpcTransport } from '../grpc/transport';
import { AuthService } from './auth.service';

export type { BibliographyEntry, Source };

/** CSL-JSON shape, narrowed to what the manual entry form edits (FR-BIB-02/03). */
export interface CslJson {
  id?: string;
  type?: string;
  title?: string;
  author?: { family?: string; given?: string; literal?: string }[];
  'container-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  issued?: { 'date-parts': number[][] };
  page?: string;
  volume?: string;
  issue?: string;
  DOI?: string;
  ISBN?: string;
  URL?: string;
  [key: string]: unknown;
}

/** Source types the entry form offers (FR-BIB-01), mapped to CSL types. */
export const SOURCE_TYPES = [
  { value: 'book', labelKey: 'sources.type.book' },
  { value: 'chapter', labelKey: 'sources.type.chapter' },
  { value: 'article-journal', labelKey: 'sources.type.article' },
  { value: 'paper-conference', labelKey: 'sources.type.conference' },
  { value: 'thesis', labelKey: 'sources.type.thesis' },
  { value: 'standard', labelKey: 'sources.type.standard' },
  { value: 'legislation', labelKey: 'sources.type.legislation' },
  { value: 'webpage', labelKey: 'sources.type.webpage' },
  { value: 'software', labelKey: 'sources.type.software' },
  { value: 'document', labelKey: 'sources.type.other' },
] as const;

export interface ParsedSource extends Source {
  csl: CslJson;
}

/**
 * Per-document source library + bibliography preview (06-bibliography.md).
 * State is per-document: `load(documentId)` swaps the whole library, so the
 * service is used from the editor only, one document at a time.
 */
@Injectable({ providedIn: 'root' })
export class SourceService {
  private readonly client = new DocumentServiceClient(grpcTransport);
  private readonly auth = inject(AuthService);

  private readonly _documentId = signal('');
  private readonly _sources = signal<ParsedSource[]>([]);
  private readonly _entries = signal<BibliographyEntry[]>([]);
  private readonly _orphanedCitationIds = signal<string[]>([]);
  private readonly _loading = signal(false);

  readonly sources = this._sources.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly orphanedCitationIds = this._orphanedCitationIds.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** sourceId → rendered number, for the editor's citation decorations. */
  readonly citationNumbers = computed(() => {
    const map = new Map<string, number>();
    for (const entry of this._entries()) map.set(entry.sourceId, entry.number);
    return map;
  });

  readonly hasOrphans = computed(() => this._orphanedCitationIds().length > 0);

  async load(documentId: string): Promise<void> {
    this._documentId.set(documentId);
    this._loading.set(true);
    try {
      const resp = await this.auth.callWithAuthRetry(
        () => this.client.listSources({ documentId }).response
      );
      this._sources.set(resp.sources.map(parseSource));
      await this.refreshBibliography();
    } finally {
      this._loading.set(false);
    }
  }

  /** Re-renders the reference list server-side (FR-BIB-10) — the same pass
   * export uses, so preview and docx can't disagree. Call after any change to
   * sources or to citations in content. */
  async refreshBibliography(): Promise<void> {
    const documentId = this._documentId();
    if (!documentId) return;
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.getBibliography({ documentId }).response
    );
    this._entries.set(resp.entries);
    this._orphanedCitationIds.set(resp.orphanedCitationIds);
  }

  async add(
    csl: CslJson,
    language: string,
    rawInput: string,
    fillStatus: string,
    accessDate = ''
  ): Promise<ParsedSource> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.addSource({
          documentId: this._documentId(),
          cslJson: JSON.stringify(csl),
          language,
          rawInput,
          fillStatus,
          accessDate,
        }).response
    );
    if (!resp.source) throw new Error('addSource: empty response');
    const source = parseSource(resp.source);
    this._sources.update((list) => [...list, source]);
    await this.refreshBibliography();
    return source;
  }

  async update(
    sourceId: string,
    csl: CslJson,
    language: string,
    fillStatus: string,
    accessDate = '',
    includeUncitedOverride = false
  ): Promise<void> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.updateSource({
          documentId: this._documentId(),
          sourceId,
          cslJson: JSON.stringify(csl),
          language,
          fillStatus,
          accessDate,
          includeUncitedOverride,
        }).response
    );
    if (resp.source) {
      const updated = parseSource(resp.source);
      this._sources.update((list) => list.map((s) => (s.id === sourceId ? updated : s)));
    }
    await this.refreshBibliography();
  }

  async remove(sourceId: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () => this.client.deleteSource({ documentId: this._documentId(), sourceId }).response
    );
    this._sources.update((list) => list.filter((s) => s.id !== sourceId));
    // Citations pointing here become orphans rather than disappearing
    // (FR-BIB-07); the refresh is what surfaces them.
    await this.refreshBibliography();
  }

  /** DOI/ISBN/URL → draft CSL-JSON for the form (FR-BIB-04). Nothing is saved
   * until the user confirms. */
  async resolve(
    input: string
  ): Promise<{ csl: CslJson | null; resolver: string; fillStatus: string; warning: string }> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.resolveSource({ input }).response
    );
    return {
      csl: resp.cslJson ? (JSON.parse(resp.cslJson) as CslJson) : null,
      resolver: resp.resolver,
      fillStatus: resp.fillStatus,
      warning: resp.warning,
    };
  }
}

function parseSource(source: Source): ParsedSource {
  let csl: CslJson = {};
  try {
    csl = source.cslJson ? (JSON.parse(source.cslJson) as CslJson) : {};
  } catch {
    csl = {};
  }
  return { ...source, csl };
}

/** "Прізвище, І. Б." display helper used by the picker and list rows. */
export function formatAuthors(csl: CslJson): string {
  const authors = csl.author ?? [];
  const names = authors
    .map((a) => {
      if (a.literal) return a.literal;
      const initials = (a.given ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => `${part[0]}.`)
        .join(' ');
      return [a.family, initials].filter(Boolean).join(', ');
    })
    .filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 3) return names.join('; ');
  return `${names[0]} та ін.`;
}

export function sourceYear(csl: CslJson): string {
  const parts = csl.issued?.['date-parts']?.[0];
  return parts?.[0] ? String(parts[0]) : '';
}
