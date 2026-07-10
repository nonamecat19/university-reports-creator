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
import { FileService } from '../../../core/services/file.service';
import { buildSectionExtensions } from './schema/extensions';
import { numberingPluginKey } from './schema/numbering.extension';

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
        <button type="button" class="tb-btn" (click)="editor.chain().focus().setHorizontalRule().run()" title="Розрив сторінки"><i class="pi pi-file"></i></button>
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
  @Input() editable = true;

  /** Emits on every keystroke (current JSON) — cheap, used for live numbering
   * recompute only, never persisted directly. */
  @Output() dirty = new EventEmitter<object>();
  /** Emits ~2s after edits stop — the actual autosave payload (FR-EDT-09). */
  @Output() save = new EventEmitter<object>();

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
    });
    this.pushNumbering();
  }

  private pushNumbering(): void {
    const tr = this.editor.state.tr.setMeta(numberingPluginKey, this.numberingMap);
    this.editor.view.dispatch(tr);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushNow(), AUTOSAVE_DEBOUNCE_MS);
  }

  /** Forces an immediate save (Ctrl+S) rather than waiting for the debounce. */
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
    const { id: objectKey } = await this.fileService.upload(file);

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
