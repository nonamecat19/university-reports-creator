import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { referenceText } from '../numbering';

/**
 * Cross-reference node (FR-EDT-04/07). The node stores only the id of what it
 * points at — a block id for a figure/table/formula/heading, or a section id
 * for a whole section. Both the number *and* the wording («рис. 2.1» vs
 * «табл. 2.1») are resolved from the live numbering counters, so references
 * never go stale when blocks are inserted, moved or renumbered.
 *
 * Labels arrive the way citation numbers do: the host pushes a
 * targetId → label map through a transaction meta and a decoration renders it.
 * An unknown id renders as `[?]` — the target was deleted, which blocks export.
 */
export const referenceLabelsPluginKey = new PluginKey<Map<string, string>>('referenceLabels');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    crossReference: {
      insertCrossReference: (attrs: { targetId: string }) => ReturnType;
    };
  }
}

export const CrossReference = Node.create({
  name: 'crossReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      targetId: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-cross-reference]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-cross-reference': '',
        class: 'cross-reference-node',
      }),
    ];
  },

  addCommands() {
    return {
      insertCrossReference:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: referenceLabelsPluginKey,
        state: {
          init: () => new Map<string, string>(),
          apply: (tr, old) => tr.getMeta(referenceLabelsPluginKey) ?? old,
        },
        props: {
          decorations(state) {
            const labels = referenceLabelsPluginKey.getState(state);
            const decorations: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'crossReference') return;
              const targetId = node.attrs['targetId'] as string;
              const label = labels?.get(targetId);

              decorations.push(
                Decoration.widget(
                  pos,
                  () => {
                    const span = document.createElement('span');
                    span.className = label ? 'reference-label' : 'reference-label reference-orphan';
                    span.contentEditable = 'false';
                    span.textContent = label ?? referenceText.unresolved;
                    if (!label) {
                      span.title = 'Об’єкт видалено — виправте посилання перед експортом';
                    }
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
