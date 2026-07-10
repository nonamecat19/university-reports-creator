import { Mark } from '@tiptap/core';

/**
 * Suggestion marks reserved in the schema from P2 so review mode (P4,
 * FR-REV-09..11) never needs a content migration. Not applied by any command
 * yet — insertion/deletion authoring lands with review mode.
 */
export const SuggestionInsert = Mark.create({
  name: 'suggestionInsert',
  addAttributes() {
    return {
      suggestionId: { default: null },
      authorId: { default: null },
      timestamp: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'ins[data-suggestion-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'ins',
      { 'data-suggestion-id': HTMLAttributes['suggestionId'], class: 'suggestion-insert' },
      0,
    ];
  },
});

export const SuggestionDelete = Mark.create({
  name: 'suggestionDelete',
  addAttributes() {
    return {
      suggestionId: { default: null },
      authorId: { default: null },
      timestamp: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'del[data-suggestion-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'del',
      { 'data-suggestion-id': HTMLAttributes['suggestionId'], class: 'suggestion-delete' },
      0,
    ];
  },
});
