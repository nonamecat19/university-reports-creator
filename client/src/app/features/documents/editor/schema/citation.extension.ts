import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * In-text citation node (FR-BIB-05). The node stores only the source id and an
 * optional locator ("с. 45"); the rendered number is computed, never stored —
 * so inserting, deleting or reordering citations renumbers everything live
 * (FR-BIB-06) without touching stored content.
 *
 * Numbers arrive the same way section numbering does: the host pushes a
 * sourceId → number map through a transaction meta, and a decoration renders
 * the bracketed label. An unknown source id renders as `[?]` — the orphan flag
 * that FR-BIB-07 requires and that blocks export.
 */
export const citationNumbersPluginKey = new PluginKey<Map<string, number>>('citationNumbers');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: { sourceId: string; locator?: string }) => ReturnType;
    };
  }
}

export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      sourceId: { default: '' },
      // Page/range within the source, rendered as "[N, с. 45]".
      locator: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-citation': '', class: 'citation-node' }),
    ];
  },

  addCommands() {
    return {
      insertCitation:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: citationNumbersPluginKey,
        state: {
          init: () => new Map<string, number>(),
          apply: (tr, old) => tr.getMeta(citationNumbersPluginKey) ?? old,
        },
        props: {
          decorations(state) {
            const numbers = citationNumbersPluginKey.getState(state);
            const decorations: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'citation') return;
              const sourceId = node.attrs['sourceId'] as string;
              const locator = (node.attrs['locator'] as string) ?? '';
              const number = numbers?.get(sourceId);
              const label = number ? `[${number}${locator ? `, ${locator}` : ''}]` : '[?]';

              decorations.push(
                Decoration.widget(
                  pos,
                  () => {
                    const span = document.createElement('span');
                    span.className = number ? 'citation-label' : 'citation-label citation-orphan';
                    span.contentEditable = 'false';
                    span.textContent = label;
                    if (!number)
                      span.title = 'Джерело видалено — виправте посилання перед експортом';
                    return span;
                  },
                  { side: -1 }
                )
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
