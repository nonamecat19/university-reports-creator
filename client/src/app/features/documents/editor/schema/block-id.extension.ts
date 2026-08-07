import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Stamps a stable `blockId` UUID onto every top-level content block (FR-EDT-04).
 * Comment anchors, cross-references, and the suggestion registry all target
 * block IDs rather than positions, so an ID must survive edits/reorders and be
 * regenerated when a block is duplicated (copy-paste) instead of reused.
 */
export const BLOCK_ID_NODE_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'table',
  'image',
  'formulaBlock',
  'codeBlock',
  'horizontalRule',
];

const pluginKey = new PluginKey('blockId');

export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_NODE_TYPES,
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              if (!attributes['blockId']) return {};
              return { 'data-block-id': attributes['blockId'] };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const tr = newState.tr;
          const seen = new Set<string>();
          let changed = false;

          newState.doc.descendants((node, pos) => {
            if (!BLOCK_ID_NODE_TYPES.includes(node.type.name)) return;
            const id = node.attrs['blockId'];
            if (!id || seen.has(id)) {
              tr.setNodeAttribute(pos, 'blockId', crypto.randomUUID());
              changed = true;
            } else {
              seen.add(id);
            }
          });

          return changed ? tr : null;
        },
      }),
    ];
  },
});
