import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { captionText } from '../numbering';

/** Shared plugin key so the host component can push a fresh numbering map in
 * via a transaction meta whenever numbering is recomputed (FR-EDT-07: renders
 * live, re-flows on reorder/insert/delete — numbers are never stored in the
 * document, only decorated at render time). */
export const numberingPluginKey = new PluginKey<Map<string, string>>('numbering');

export const Numbering = Extension.create({
  name: 'numbering',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: numberingPluginKey,
        state: {
          init: () => new Map<string, string>(),
          apply(tr, old) {
            const meta = tr.getMeta(numberingPluginKey);
            return meta ?? old;
          },
        },
        props: {
          decorations(state) {
            const map = numberingPluginKey.getState(state);
            if (!map || map.size === 0) return null;

            const decorations: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              const blockId = node.attrs['blockId'] as string | undefined;
              if (!blockId) return;
              const number = map.get(blockId);
              if (!number) return;

              if (node.type.name === 'heading') {
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    () => {
                      const span = document.createElement('span');
                      span.className = 'doc-number doc-number-heading';
                      span.contentEditable = 'false';
                      span.textContent = `${number} `;
                      return span;
                    },
                    { side: -1 }
                  )
                );
              } else if (node.type.name === 'image') {
                decorations.push(
                  Decoration.widget(
                    pos + node.nodeSize,
                    () => {
                      const div = document.createElement('div');
                      div.className = 'doc-number doc-number-figure';
                      div.contentEditable = 'false';
                      div.textContent = captionText.figure(
                        number,
                        (node.attrs['caption'] as string) ?? ''
                      );
                      return div;
                    },
                    { side: 1 }
                  )
                );
              } else if (node.type.name === 'formulaBlock') {
                // The number sits on the formula's own line, right-aligned
                // (ДСТУ 3008:2015) — a node decoration hands it to the node
                // view's CSS rather than inserting a widget that would break
                // the centred layout.
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    'data-number': captionText.formula(number),
                  })
                );
              } else if (node.type.name === 'table') {
                decorations.push(
                  Decoration.widget(
                    pos,
                    () => {
                      const div = document.createElement('div');
                      div.className = 'doc-number doc-number-table';
                      div.contentEditable = 'false';
                      div.textContent = captionText.table(
                        number,
                        (node.attrs['caption'] as string) ?? ''
                      );
                      return div;
                    },
                    { side: -1 }
                  )
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
