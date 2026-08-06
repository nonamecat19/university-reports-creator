import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

/**
 * Suggest mode (FR-REV-09..12). While active, edits never change the document
 * directly:
 *
 *  * typed text is inserted carrying a `suggestionInsert` mark;
 *  * deleted text is *kept* and marked `suggestionDelete` instead of removed;
 *  * structural operations (tables, images, section moves) are blocked —
 *    reviewers leave a comment instead (FR-REV-12).
 *
 * The marks are the source of truth; a registry row per suggestion id is
 * written server-side for listing and accept/reject (FR-REV-11).
 */
export const suggestModePluginKey = new PluginKey<SuggestModeState>('suggestMode');

export interface SuggestModeState {
  active: boolean;
  authorId: string;
  /** Suggestion ids created since the last flush, for registry sync. */
  pending: { id: string; kind: 'insert' | 'delete' }[];
}

/** Node types a reviewer may not add or remove in suggest mode (FR-REV-12). */
const STRUCTURAL_TYPES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader', 'image']);

function newSuggestionId(): string {
  return crypto.randomUUID();
}

/** Blocks a transaction that adds or removes a structural node. */
function touchesStructure(tr: Transaction, state: EditorState): boolean {
  let structural = false;

  tr.steps.forEach((step, index) => {
    const slice = (step as unknown as { slice?: { content: { descendants?: unknown } } }).slice;
    if (slice?.content) {
      (
        slice.content as unknown as {
          descendants(fn: (n: { type: { name: string } }) => void): void;
        }
      ).descendants((node) => {
        if (STRUCTURAL_TYPES.has(node.type.name)) structural = true;
      });
    }

    // Removals show up as a step whose *source* range covers a structural
    // node, which the slice above cannot see.
    const map = tr.mapping.maps[index];
    const before = index === 0 ? state.doc : tr.docs[index];
    map.forEach((from, to) => {
      before.nodesBetween(Math.max(from, 0), Math.min(to, before.content.size), (node) => {
        if (STRUCTURAL_TYPES.has(node.type.name)) structural = true;
      });
    });
  });

  return structural;
}

export const SuggestMode = Extension.create({
  name: 'suggestMode',

  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestModeState>({
        key: suggestModePluginKey,

        state: {
          init: () => ({ active: false, authorId: '', pending: [] }),
          apply(tr, previous) {
            const meta = tr.getMeta(suggestModePluginKey) as Partial<SuggestModeState> | undefined;
            return meta ? { ...previous, ...meta } : previous;
          },
        },

        filterTransaction(tr, state) {
          const mode = suggestModePluginKey.getState(state);
          if (!mode?.active || !tr.docChanged) return true;
          // Silently dropping is intentional: the toolbar disables these
          // actions in suggest mode, so reaching here means a paste or a
          // keyboard shortcut, where a no-op is the least surprising outcome.
          return !touchesStructure(tr, state);
        },

        appendTransaction(transactions, oldState, newState) {
          const mode = suggestModePluginKey.getState(newState);
          if (!mode?.active) return null;
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Our own rewrite must not be rewritten again.
          if (transactions.some((tr) => tr.getMeta(suggestModePluginKey))) return null;

          const insertMark = newState.schema.marks['suggestionInsert'];
          const deleteMark = newState.schema.marks['suggestionDelete'];
          if (!insertMark || !deleteMark) return null;

          const created: SuggestModeState['pending'] = [];
          const tr = newState.tr;
          const timestamp = new Date().toISOString();

          for (const source of transactions) {
            if (!source.docChanged) continue;

            source.steps.forEach((step, index) => {
              const before = index === 0 ? oldState.doc : source.docs[index];
              const map = source.mapping.maps[index];

              map.forEach((fromA, toA, fromB, toB) => {
                // Deleted range: put the text back, marked as a deletion, so
                // the owner can see and reject what was removed.
                if (toA > fromA) {
                  const removed = before.slice(fromA, toA);
                  if (removed.content.size > 0) {
                    const id = newSuggestionId();
                    created.push({ id, kind: 'delete' });
                    const mark = deleteMark.create({
                      suggestionId: id,
                      authorId: mode.authorId,
                      timestamp,
                    });
                    const position = source.mapping.slice(index).map(fromB);
                    tr.insert(tr.mapping.map(position), removed.content);
                    tr.addMark(
                      tr.mapping.map(position),
                      tr.mapping.map(position) + removed.content.size,
                      mark
                    );
                  }
                }

                // Inserted range: mark it so it renders as a proposal.
                if (toB > fromB) {
                  const id = newSuggestionId();
                  created.push({ id, kind: 'insert' });
                  const mark = insertMark.create({
                    suggestionId: id,
                    authorId: mode.authorId,
                    timestamp,
                  });
                  tr.addMark(tr.mapping.map(fromB), tr.mapping.map(toB), mark);
                }
              });
            });
          }

          if (created.length === 0) return null;

          tr.setMeta(suggestModePluginKey, { pending: [...mode.pending, ...created] });
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});

/** Reads the suggestion ids created since the last flush. */
export function drainPendingSuggestions(state: EditorState): SuggestModeState['pending'] {
  return suggestModePluginKey.getState(state)?.pending ?? [];
}

/** Walks a ProseMirror JSON doc collecting the suggestion ids present in it —
 * used to reconcile the registry with content (FR-REV-11). */
export function collectSuggestionIds(node: unknown): { id: string; kind: 'insert' | 'delete' }[] {
  const out = new Map<string, 'insert' | 'delete'>();

  const walk = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as {
      marks?: { type?: string; attrs?: { suggestionId?: string } }[];
      content?: unknown[];
    };
    for (const mark of record.marks ?? []) {
      const id = mark.attrs?.suggestionId;
      if (!id) continue;
      if (mark.type === 'suggestionInsert') out.set(id, 'insert');
      else if (mark.type === 'suggestionDelete') out.set(id, 'delete');
    }
    for (const child of record.content ?? []) walk(child);
  };

  walk(node);
  return [...out.entries()].map(([id, kind]) => ({ id, kind }));
}

/**
 * Applies a suggestion resolution to a ProseMirror JSON doc, returning the
 * new doc. Accepting an insertion strips its mark; accepting a deletion drops
 * the text. Rejecting is the mirror image. Done on JSON rather than in the
 * editor so the same code resolves suggestions in sections that aren't
 * currently mounted.
 */
export function resolveSuggestionInDoc(
  doc: unknown,
  suggestionId: string,
  accept: boolean
): unknown {
  const transform = (node: unknown): unknown | null => {
    if (!node || typeof node !== 'object') return node;
    const record = { ...(node as Record<string, unknown>) };

    const marks = (record['marks'] as { type?: string; attrs?: { suggestionId?: string } }[]) ?? [];
    const match = marks.find((m) => m.attrs?.suggestionId === suggestionId);
    if (match) {
      const isInsert = match.type === 'suggestionInsert';
      const keep = accept ? isInsert : !isInsert;
      if (!keep) return null;
      const remaining = marks.filter((m) => m.attrs?.suggestionId !== suggestionId);
      if (remaining.length > 0) record['marks'] = remaining;
      else delete record['marks'];
    }

    const content = record['content'] as unknown[] | undefined;
    if (content) {
      record['content'] = content.map(transform).filter((child) => child !== null);
    }
    return record;
  };

  return transform(doc);
}

/** Resolves every pending suggestion in a doc at once (bulk accept/reject,
 * FR-REV-10). */
export function resolveAllSuggestionsInDoc(doc: unknown, accept: boolean): unknown {
  let result = doc;
  for (const { id } of collectSuggestionIds(doc)) {
    result = resolveSuggestionInDoc(result, id, accept);
  }
  return result;
}
