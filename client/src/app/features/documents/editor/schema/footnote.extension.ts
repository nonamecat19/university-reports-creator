import { mergeAttributes, Node, type NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view';

/**
 * Footnote node (FR-EDT-04). An inline atom that stores only the note's text;
 * the marker number is derived from document order and rendered as a
 * decoration, never stored — inserting or deleting a note renumbers the rest
 * live, the same contract citations and cross-references follow.
 *
 * The number shown in the editor is per-section and sequential. It is
 * deliberately *not* sent to service-render: Word owns footnote numbering once
 * the notes are real `w:footnote` parts, and it renumbers per page layout,
 * which the editor cannot know.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (text?: string) => ReturnType;
    };
  }
}

const PLACEHOLDER = 'текст виноски';

export const footnoteNumbersPluginKey = new PluginKey<DecorationSet>('footnoteNumbers');

/** Marker plus an inline box for the note's text while it is being edited.
 * The text lives in the node, so it survives a reload the same way any other
 * content does — the box is only an editing surface. */
class FootnoteNodeView implements NodeView {
  readonly dom: HTMLElement;
  private input: HTMLTextAreaElement | null = null;

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined
  ) {
    // The marker itself is drawn by CSS from the `data-number` decoration on
    // this element, so the node view owns no marker child of its own.
    this.dom = document.createElement('span');
    this.dom.className = 'footnote-node';
    this.syncTitle();

    this.dom.addEventListener('mousedown', (event) => {
      if (this.input) return;
      event.preventDefault();
      this.startEditing();
    });
  }

  private get text(): string {
    return (this.node.attrs['text'] as string) ?? '';
  }

  /** The note text is not visible inline, so the tooltip is the only way to
   * read it without opening the editor box. */
  private syncTitle(): void {
    this.dom.title = this.text || PLACEHOLDER;
    this.dom.classList.toggle('footnote-empty', !this.text.trim());
  }

  private startEditing(): void {
    if (this.input || !this.view.editable) return;

    const input = document.createElement('textarea');
    input.className = 'footnote-text';
    input.value = this.text;
    input.rows = 2;
    input.placeholder = PLACEHOLDER;
    input.setAttribute('aria-label', 'Текст виноски');
    this.input = input;
    this.dom.appendChild(input);
    this.dom.classList.add('footnote-editing');
    input.focus();
    input.select();

    input.addEventListener('blur', () => this.commit(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        // Shift+Enter keeps a multi-line note editable; plain Enter commits.
        event.preventDefault();
        this.commit(input.value);
      }
    });
  }

  private closeInput(): void {
    this.input?.remove();
    this.input = null;
    this.dom.classList.remove('footnote-editing');
  }

  private cancel(): void {
    this.closeInput();
    this.view.focus();
  }

  private commit(text: string): void {
    if (!this.input) return;
    this.closeInput();

    const pos = this.getPos();
    if (pos === undefined || text === this.text) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'text', text));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncTitle();
    return true;
  }

  stopEvent(event: Event): boolean {
    // `Node` here is TipTap's, so the DOM one needs qualifying.
    return this.input !== null && this.dom.contains(event.target as globalThis.Node);
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

const nodeView: NodeViewRenderer = ({ node, view, getPos }) =>
  new FootnoteNodeView(node as PMNode, view as EditorView, getPos as () => number | undefined);

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-text') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-text': (attributes['text'] as string) ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-footnote]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-footnote': '' })];
  },

  addNodeView() {
    return nodeView;
  },

  addCommands() {
    return {
      insertFootnote:
        (text = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { text } }),
    };
  },

  addProseMirrorPlugins() {
    const type = this.name;
    return [
      new Plugin<DecorationSet>({
        key: footnoteNumbersPluginKey,
        state: {
          init: (_, state) => numberFootnotes(state.doc, type),
          apply: (tr, current) =>
            tr.docChanged ? numberFootnotes(tr.doc, type) : current.map(tr.mapping, tr.doc),
        },
        props: {
          decorations(state) {
            return footnoteNumbersPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** Numbers footnotes in document order and exposes each number as
 * `data-number`, which the marker renders through CSS `content`. */
function numberFootnotes(doc: PMNode, type: string): DecorationSet {
  const decorations: Decoration[] = [];
  let index = 0;

  doc.descendants((node, pos) => {
    if (node.type.name !== type) return;
    index++;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-number': String(index) }));
  });

  return DecorationSet.create(doc, decorations);
}
