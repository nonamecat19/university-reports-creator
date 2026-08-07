import {
  Component,
  type ElementRef,
  EventEmitter,
  Input,
  inject,
  type OnChanges,
  type OnDestroy,
  Output,
  type SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import { FileService, Purpose } from '../../../core/services/file.service';
import { citationNumbersPluginKey } from './schema/citation.extension';
import { referenceLabelsPluginKey } from './schema/cross-reference.extension';
import { buildSectionExtensions } from './schema/extensions';
import { numberingPluginKey } from './schema/numbering.extension';
import {
  drainPendingSuggestions,
  type SuggestModeState,
  suggestModePluginKey,
} from './schema/suggest-mode.extension';

const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * One TipTap instance per document section (FR-EDT-03) — keeps documents
 * scalable and maps 1:1 to template regions. Autosave is debounced here;
 * the parent (DocumentEditorComponent) owns the actual RPC + revision
 * tracking (FR-EDT-09), since conflicts are resolved per section there.
 */
@Component({
  selector: 'app-section-editor',
  standalone: true,
  template: `
    <div class="section-editor">
      <div class="toolbar">
        <button type="button" class="tb-btn" [class.active]="isActive('bold')" (click)="editor.chain().focus().toggleBold().run()" title="Жирний (Ctrl+B)"><i class="pi pi-bold"></i></button>
        <button type="button" class="tb-btn" [class.active]="isActive('italic')" (click)="editor.chain().focus().toggleItalic().run()" title="Курсив (Ctrl+I)"><i class="pi pi-italic"></i></button>
        <button type="button" class="tb-btn" [class.active]="isActive('underline')" (click)="editor.chain().focus().toggleUnderline().run()" title="Підкреслення"><i class="pi pi-underline"></i></button>
        <button type="button" class="tb-btn" [class.active]="isActive('strike')" (click)="editor.chain().focus().toggleStrike().run()" title="Закреслення"><i class="pi pi-strikethrough"></i></button>
        <span class="tb-sep"></span>
        <button type="button" class="tb-btn" [class.active]="isActive('subscript')" (click)="editor.chain().focus().toggleSubscript().run()" title="Нижній індекс">x<sub>2</sub></button>
        <button type="button" class="tb-btn" [class.active]="isActive('superscript')" (click)="editor.chain().focus().toggleSuperscript().run()" title="Верхній індекс">x<sup>2</sup></button>
        <span class="tb-sep"></span>
        @for (level of headingLevels; track level) {
          <button type="button" class="tb-btn" [class.active]="isActive('heading', { level })" (click)="toggleHeading(level)" [title]="'Заголовок ' + level">H{{ level }}</button>
        }
        <span class="tb-sep"></span>
        <button type="button" class="tb-btn" [class.active]="isActive('bulletList')" (click)="editor.chain().focus().toggleBulletList().run()" title="Маркований список"><i class="pi pi-list"></i></button>
        <button type="button" class="tb-btn" [class.active]="isActive('orderedList')" (click)="editor.chain().focus().toggleOrderedList().run()" title="Нумерований список"><i class="pi pi-sort-numeric-down"></i></button>
        <span class="tb-sep"></span>
        <button type="button" class="tb-btn" (click)="insertTable()" title="Вставити таблицю"><i class="pi pi-table"></i></button>
        <button type="button" class="tb-btn" (click)="triggerImagePick()" title="Вставити зображення"><i class="pi pi-image"></i></button>
        <button type="button" class="tb-btn" (click)="insertFormulaBlock()" title="Вставити формулу (нумерована, окремим рядком)"><i class="pi pi-percentage"></i></button>
        <button type="button" class="tb-btn" (click)="insertFormulaInline()" title="Вставити формулу в рядок тексту">f(x)</button>
        <button type="button" class="tb-btn" (click)="editor.chain().focus().setHorizontalRule().run()" title="Розрив сторінки"><i class="pi pi-file"></i></button>
        <button type="button" class="tb-btn" (click)="requestCitation.emit()" title="Вставити посилання на джерело (Ctrl+Shift+C)"><i class="pi pi-bookmark"></i></button>
        <button type="button" class="tb-btn" (click)="requestCrossReference.emit()" title="Вставити перехресне посилання (рис./табл./розділ)"><i class="pi pi-link"></i></button>
        <span class="tb-sep"></span>
        <button type="button" class="tb-btn" (click)="editor.chain().focus().undo().run()" title="Скасувати (Ctrl+Z)"><i class="pi pi-undo"></i></button>
        <button type="button" class="tb-btn" (click)="editor.chain().focus().redo().run()" title="Повторити (Ctrl+Y)"><i class="pi pi-refresh"></i></button>
        <input #fileInput type="file" accept="image/png,image/jpeg,image/svg+xml" hidden (change)="onImagePicked($event)" />
      </div>

      @if (isTableActive()) {
        <div class="table-toolbar">
          <button type="button" class="tb-btn" (click)="editor.chain().focus().addColumnAfter().run()">+ Колонка</button>
          <button type="button" class="tb-btn" (click)="editor.chain().focus().deleteColumn().run()">− Колонка</button>
          <button type="button" class="tb-btn" (click)="editor.chain().focus().addRowAfter().run()">+ Рядок</button>
          <button type="button" class="tb-btn" (click)="editor.chain().focus().deleteRow().run()">− Рядок</button>
          <button type="button" class="tb-btn" (click)="editor.chain().focus().toggleHeaderRow().run()">Заголовний рядок</button>
          <button type="button" class="tb-btn" (click)="editor.chain().focus().mergeOrSplit().run()">Об'єднати/розділити</button>
          <button type="button" class="tb-btn" (click)="editor.chain().focus().deleteTable().run()">Видалити таблицю</button>
        </div>
      }

      <div class="editor-surface" #editorHost (mousedown)="focusIfSurfaceClicked($event)"></div>
    </div>
  `,
  styles: `
    .section-editor {
      border: 1px solid var(--p-content-border-color, #dcdfe4);
      border-radius: 8px;
      background: var(--p-content-background, #fff);
    }
    .toolbar, .table-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      padding: 0.4rem 0.5rem;
      border-bottom: 1px solid var(--p-content-border-color, #dcdfe4);
    }
    .table-toolbar {
      background: var(--p-surface-50, #f8f9fb);
    }
    .tb-sep {
      width: 1px;
      background: var(--p-content-border-color, #dcdfe4);
      margin: 0 0.25rem;
    }
    .tb-btn {
      border: none;
      background: transparent;
      border-radius: 6px;
      padding: 0.3rem 0.5rem;
      cursor: pointer;
      font-size: 0.85rem;
      color: inherit;
    }
    .tb-btn:hover {
      background: var(--p-surface-100, #f1f3f6);
    }
    .tb-btn.active {
      background: var(--p-primary-100, #dbe7ff);
      color: var(--p-primary-700, #1d4ed8);
    }
    .editor-surface {
      padding: 1rem 1.25rem;
      min-height: 8rem;
      font-family: 'Times New Roman', serif;
      font-size: 14pt;
      line-height: 1.5;
    }
    .editor-surface :global(.suggestion-insert) {
      color: var(--p-green-700, #15803d);
      text-decoration: underline;
    }
    .editor-surface :global(.suggestion-delete) {
      color: var(--p-red-600, #dc2626);
      text-decoration: line-through;
    }
    .editor-surface :global(.comment-anchor) {
      background: var(--p-yellow-100, #fef9c3);
      border-bottom: 1px dashed var(--p-yellow-500, #eab308);
    }
    .editor-surface :global(.citation-label) {
      color: var(--p-primary-700, #1d4ed8);
      cursor: default;
    }
    .editor-surface :global(.citation-orphan),
    .editor-surface :global(.reference-orphan) {
      color: var(--p-red-500, #ef4444);
      text-decoration: underline wavy;
    }
    .editor-surface :global(.reference-label) {
      color: var(--p-primary-700, #1d4ed8);
      cursor: default;
    }
    .editor-surface :global(.doc-number) {
      color: var(--p-text-muted-color, #6b7280);
      font-weight: 600;
    }
    .editor-surface :global(.doc-number-figure),
    .editor-surface :global(.doc-number-table) {
      display: block;
      text-align: center;
      font-weight: 400;
      font-size: 0.9em;
      margin: 0.25rem 0 0.75rem;
    }
    /* Display formula: centred on its line with the number right-aligned on
       the same line (ДСТУ 3008:2015). The number comes from the numbering
       decoration as a data attribute, so it is never part of the content. */
    .editor-surface :global(.formula-block) {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      margin: 0.75rem 0;
      cursor: pointer;
    }
    .editor-surface :global(.formula-block) > :global(.formula-render) {
      grid-column: 1;
      text-align: center;
    }
    .editor-surface :global(.formula-block)::after {
      content: attr(data-number);
      grid-column: 2;
      color: var(--p-text-muted-color, #6b7280);
      white-space: nowrap;
      padding-left: 1rem;
    }
    .editor-surface :global(.formula-block.formula-editing) > :global(.formula-source) {
      grid-column: 1 / -1;
    }
    .editor-surface :global(.formula-inline) {
      cursor: pointer;
    }
    .editor-surface :global(.formula-empty) {
      color: var(--p-text-muted-color, #6b7280);
      font-style: italic;
    }
    .editor-surface :global(.formula-source) {
      display: block;
      width: 100%;
      margin-top: 0.35rem;
      padding: 0.35rem 0.5rem;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      border: 1px solid var(--p-primary-300, #93b4fd);
      border-radius: 6px;
      resize: vertical;
    }
    .editor-surface :global(table) {
      border-collapse: collapse;
      width: 100%;
    }
    .editor-surface :global(td),
    .editor-surface :global(th) {
      border: 1px solid #999;
      padding: 0.35rem 0.5rem;
    }
    .editor-surface :global(img) {
      max-width: 100%;
    }
  `,
})
export class SectionEditorComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) initialContent: object | null = null;
  @Input() numberingMap: Map<string, string> = new Map();
  /** sourceId -> reference-list number, for citation decorations (FR-BIB-05). */
  @Input() citationNumbers: Map<string, number> = new Map();
  /** targetId -> rendered cross-reference label, e.g. «рис. 2.1» (FR-EDT-07). */
  @Input() referenceLabels: Map<string, string> = new Map();
  /** In suggest mode every edit becomes a suggestion (FR-REV-09). */
  @Input() suggestMode = false;
  /** Author stamped on suggestion marks. */
  @Input() authorId = '';
  @Input() editable = true;

  /** Emits on every keystroke (current JSON) — cheap, used for live numbering
   * recompute only, never persisted directly. */
  @Output() dirty = new EventEmitter<object>();
  /** Emits ~2s after edits stop — the actual autosave payload (FR-EDT-09). */
  @Output() save = new EventEmitter<object>();
  /** The user asked to cite a source; the parent opens the picker and calls
   * back into insertCitation() on this instance. */
  @Output() requestCitation = new EventEmitter<void>();
  /** The user asked to insert a cross-reference; the parent opens the target
   * picker and calls back into insertCrossReference() on this instance. */
  @Output() requestCrossReference = new EventEmitter<void>();
  /** Fired when this editor takes focus, so the parent knows which section a
   * panel action (cite, AI insert) applies to. */
  @Output() focused = new EventEmitter<void>();

  @ViewChild('editorHost', { static: true }) editorHost!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  private readonly fileService = inject(FileService);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  editor!: Editor;
  protected readonly headingLevels: readonly (2 | 3 | 4)[] = [2, 3, 4];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialContent'] && !this.editor) {
      this.createEditor();
    }
    if (changes['numberingMap'] && this.editor) {
      this.pushNumbering();
    }
    if (changes['citationNumbers'] && this.editor) {
      this.pushCitationNumbers();
    }
    if (changes['referenceLabels'] && this.editor) {
      this.pushReferenceLabels();
    }
    if ((changes['suggestMode'] || changes['authorId']) && this.editor) {
      this.pushSuggestMode();
    }
    if (changes['editable'] && this.editor) {
      this.editor.setEditable(this.editable);
    }
  }

  private createEditor(): void {
    this.editor = new Editor({
      element: this.editorHost.nativeElement,
      extensions: buildSectionExtensions(),
      content: this.initialContent ?? '',
      editable: this.editable,
      onUpdate: () => {
        this.dirty.emit(this.editor.getJSON());
        this.scheduleSave();
      },
      onSelectionUpdate: () => {
        // Triggers change detection for toolbar active-state bindings.
      },
      onFocus: () => this.focused.emit(),
    });
    this.pushNumbering();
    this.pushCitationNumbers();
    this.pushReferenceLabels();
    this.pushSuggestMode();
  }

  private pushSuggestMode(): void {
    if (!this.editor) return;
    const meta: Partial<SuggestModeState> = { active: this.suggestMode, authorId: this.authorId };
    this.editor.view.dispatch(this.editor.state.tr.setMeta(suggestModePluginKey, meta));
  }

  /** Suggestion ids created in this editor since it was mounted, for registry
   * sync after a save (FR-REV-11). */
  pendingSuggestions(): { id: string; kind: 'insert' | 'delete' }[] {
    return this.editor ? drainPendingSuggestions(this.editor.state) : [];
  }

  /** Anchor for a new comment on the current selection (FR-REV-05): the
   * enclosing block's stable id, the offsets inside it, and the selected text
   * so offsets can be repaired later. Returns null when nothing is selected.
   */
  selectionAnchor(): {
    blockId: string;
    offsetFrom: number;
    offsetTo: number;
    textSnapshot: string;
  } | null {
    if (!this.editor) return null;
    const { state } = this.editor;
    const { from, to, empty } = state.selection;
    if (empty) return null;

    const resolved = state.doc.resolve(from);
    let blockId = '';
    let blockStart = 0;
    for (let depth = resolved.depth; depth > 0; depth--) {
      const node = resolved.node(depth);
      const id = node.attrs?.['blockId'] as string | undefined;
      if (id) {
        blockId = id;
        blockStart = resolved.start(depth);
        break;
      }
    }
    if (!blockId) return null;

    return {
      blockId,
      offsetFrom: from - blockStart,
      offsetTo: to - blockStart,
      textSnapshot: state.doc.textBetween(from, to, ' '),
    };
  }

  /** Inserts a citation node at the cursor (FR-BIB-05). The rendered `[N]` is
   * computed from the reference list, so only the source id is stored. */
  insertCitation(sourceId: string, locator = ''): void {
    this.editor.chain().focus().insertCitation({ sourceId, locator }).run();
  }

  /** Inserts a cross-reference at the cursor (FR-EDT-04). Like citations, only
   * the target id is stored — number and wording are resolved live. */
  insertCrossReference(targetId: string): void {
    this.editor.chain().focus().insertCrossReference({ targetId }).run();
  }

  private pushCitationNumbers(): void {
    if (!this.editor) return;
    const tr = this.editor.state.tr.setMeta(citationNumbersPluginKey, this.citationNumbers);
    this.editor.view.dispatch(tr);
  }

  private pushReferenceLabels(): void {
    if (!this.editor) return;
    const tr = this.editor.state.tr.setMeta(referenceLabelsPluginKey, this.referenceLabels);
    this.editor.view.dispatch(tr);
  }

  private pushNumbering(): void {
    const tr = this.editor.state.tr.setMeta(numberingPluginKey, this.numberingMap);
    this.editor.view.dispatch(tr);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushNow(), AUTOSAVE_DEBOUNCE_MS);
  }

  /** Drops the pending debounced save without emitting — for when the parent
   * is about to persist this section's content itself and wants to await it. */
  cancelPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /** Forces an immediate save rather than waiting for the debounce. */
  flushNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save.emit(this.editor.getJSON());
  }

  /** Replaces content after a reload (e.g. stale-revision recovery, FR-EDT-09). */
  setContent(json: object): void {
    this.editor.commands.setContent(json, false);
  }

  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    return this.editor?.isActive(name, attrs) ?? false;
  }

  isTableActive(): boolean {
    return this.editor?.isActive('table') ?? false;
  }

  /** Clicking the padding below short content should still focus the editor,
   * like every other rich-text surface — otherwise a short document leaves a
   * large dead zone below the last line. */
  focusIfSurfaceClicked(event: MouseEvent): void {
    if (event.target === this.editorHost.nativeElement) {
      this.editor.chain().focus('end').run();
    }
  }

  toggleHeading(level: 2 | 3 | 4): void {
    this.editor.chain().focus().toggleHeading({ level }).run();
  }

  /** A display formula is inserted empty; the node view opens its LaTeX box on
   * click, so the student types the source where they see the result. */
  insertFormulaBlock(): void {
    this.editor.chain().focus().insertFormulaBlock().run();
  }

  insertFormulaInline(): void {
    this.editor.chain().focus().insertFormulaInline().run();
  }

  insertTable(): void {
    this.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  triggerImagePick(): void {
    this.fileInput?.nativeElement.click();
  }

  async onImagePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    const naturalSize = await readImageSize(file);
    const { id: objectKey } = await this.fileService.upload(file, Purpose.IMAGES);

    this.editor
      .chain()
      .focus()
      .setImage({
        src: localUrl,
        objectKey,
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
      } as never)
      .run();
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.editor?.destroy();
  }
}

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = URL.createObjectURL(file);
  });
}
