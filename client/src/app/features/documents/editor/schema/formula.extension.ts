import { mergeAttributes, Node, type NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import type katexNamespace from 'katex';

/**
 * Formula nodes (FR-EDT-06). Only the LaTeX **source** is stored; the rendered
 * form is produced by KaTeX in the editor and by the LaTeX→OMML converter in
 * service-render at export, so both surfaces stay derived from one truth and a
 * formula never becomes an un-editable picture in the exported docx.
 *
 * Two nodes rather than one flag, because they live in different schema groups:
 * `formulaBlock` is a numbered block (ДСТУ 3008:2015 numbers display formulas
 * `(2.1)`, right-aligned — the number is a decoration, never stored), while
 * `formulaInline` is an inline atom that flows inside a paragraph.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: {
      insertFormulaBlock: (latex?: string) => ReturnType;
      insertFormulaInline: (latex?: string) => ReturnType;
    };
  }
}

const PLACEHOLDER = 'формула';

/** KaTeX is ~280 kB and most documents contain no formulas, so it is fetched
 * on first render instead of riding in the initial bundle. Until it lands the
 * node shows its own LaTeX source, which is still meaningful. */
let katex: typeof katexNamespace | null = null;
let katexLoad: Promise<void> | null = null;

function loadKatex(): Promise<void> {
  katexLoad ??= import('katex').then((module) => {
    katex = module.default ?? (module as unknown as typeof katexNamespace);
  });
  return katexLoad;
}

function renderInto(target: HTMLElement, latex: string, displayMode: boolean): void {
  if (!latex.trim()) {
    target.textContent = PLACEHOLDER;
    target.classList.add('formula-empty');
    return;
  }
  target.classList.remove('formula-empty');

  if (!katex) {
    target.textContent = latex;
    void loadKatex().then(() => renderInto(target, latex, displayMode));
    return;
  }

  katex.render(latex, target, {
    displayMode,
    throwOnError: false,
    // KaTeX prints unparseable source in `errorColor` instead of throwing, which
    // is what we want: the student keeps typing and sees the broken part in red.
    errorColor: '#dc2626',
    output: 'htmlAndMathml',
    strict: false,
  });
}

/** Node view shared by both formula nodes: renders with KaTeX, and swaps in a
 * LaTeX source box (with live preview) while the node is being edited. */
class FormulaNodeView implements NodeView {
  readonly dom: HTMLElement;
  private readonly preview: HTMLElement;
  private input: HTMLTextAreaElement | null = null;

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly displayMode: boolean
  ) {
    this.dom = document.createElement(displayMode ? 'div' : 'span');
    this.dom.className = displayMode ? 'formula-block' : 'formula-inline';

    this.preview = document.createElement(displayMode ? 'div' : 'span');
    this.preview.className = 'formula-render';
    this.dom.appendChild(this.preview);
    this.renderPreview(this.latex);

    this.dom.addEventListener('mousedown', (event) => {
      if (this.input) return;
      event.preventDefault();
      this.startEditing();
    });
  }

  private get latex(): string {
    return (this.node.attrs['latex'] as string) ?? '';
  }

  private renderPreview(latex: string): void {
    renderInto(this.preview, latex, this.displayMode);
  }

  private startEditing(): void {
    if (this.input || !this.view.editable) return;

    const input = document.createElement('textarea');
    input.className = 'formula-source';
    input.value = this.latex;
    input.rows = this.displayMode ? 2 : 1;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'LaTeX-джерело формули');
    this.input = input;
    this.dom.appendChild(input);
    this.dom.classList.add('formula-editing');
    input.focus();
    input.select();

    input.addEventListener('input', () => this.renderPreview(input.value));
    input.addEventListener('blur', () => this.commit(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        // Shift+Enter keeps multi-line LaTeX editable; plain Enter commits.
        event.preventDefault();
        this.commit(input.value);
      }
    });
  }

  private closeInput(): void {
    this.input?.remove();
    this.input = null;
    this.dom.classList.remove('formula-editing');
  }

  private cancel(): void {
    this.closeInput();
    this.renderPreview(this.latex);
    this.view.focus();
  }

  private commit(latex: string): void {
    if (!this.input) return;
    this.closeInput();

    const pos = this.getPos();
    if (pos === undefined || latex === this.latex) {
      this.renderPreview(this.latex);
      return;
    }
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'latex', latex));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.input) this.renderPreview(this.latex);
    return true;
  }

  /** Keystrokes inside the source box belong to the textarea, not to
   * ProseMirror — without this the editor would swallow them. */
  stopEvent(event: Event): boolean {
    // `Node` here is TipTap's, so the DOM one needs qualifying.
    return this.input !== null && this.dom.contains(event.target as globalThis.Node);
  }

  /** The KaTeX subtree is generated DOM, not editor content. */
  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  destroy(): void {
    this.closeInput();
  }
}

function nodeView(displayMode: boolean): NodeViewRenderer {
  return ({ node, view, getPos }) =>
    new FormulaNodeView(
      node as PMNode,
      view as EditorView,
      getPos as () => number | undefined,
      displayMode
    );
}

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-latex': (attributes['latex'] as string) ?? '',
    }),
  },
};

export const FormulaBlock = Node.create({
  name: 'formulaBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: 'div[data-formula-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-formula-block': '' })];
  },

  addNodeView() {
    return nodeView(true);
  },

  addCommands() {
    return {
      insertFormulaBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

export const FormulaInline = Node.create({
  name: 'formulaInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: 'span[data-formula-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-formula-inline': '' })];
  },

  addNodeView() {
    return nodeView(false);
  },

  addCommands() {
    return {
      insertFormulaInline:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});
