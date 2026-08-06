import {
  collectSuggestionIds,
  resolveAllSuggestionsInDoc,
  resolveSuggestionInDoc,
} from './suggest-mode.extension';

/** A paragraph with plain text, one proposed insertion and one proposed
 * deletion — the shape suggest mode produces (FR-REV-09). */
function docWithSuggestions() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block-1' },
        content: [
          { type: 'text', text: 'звичайний ' },
          {
            type: 'text',
            text: 'доданий',
            marks: [
              { type: 'bold' },
              { type: 'suggestionInsert', attrs: { suggestionId: 'sug-ins' } },
            ],
          },
          {
            type: 'text',
            text: 'видалений',
            marks: [{ type: 'suggestionDelete', attrs: { suggestionId: 'sug-del' } }],
          },
        ],
      },
    ],
  };
}

function textOf(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { text?: string; content?: unknown[] };
    if (record.text) parts.push(record.text);
    for (const child of record.content ?? []) walk(child);
  };
  walk(doc);
  return parts.join('');
}

function marksOf(doc: unknown, text: string): { type?: string }[] {
  let found: { type?: string }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { text?: string; marks?: { type?: string }[]; content?: unknown[] };
    if (record.text === text) found = record.marks ?? [];
    for (const child of record.content ?? []) walk(child);
  };
  walk(doc);
  return found;
}

describe('collectSuggestionIds', () => {
  it('finds insertion and deletion ids with their kinds', () => {
    expect(collectSuggestionIds(docWithSuggestions())).toEqual([
      { id: 'sug-ins', kind: 'insert' },
      { id: 'sug-del', kind: 'delete' },
    ]);
  });

  it('returns nothing for a doc without suggestions', () => {
    expect(collectSuggestionIds({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

describe('resolveSuggestionInDoc', () => {
  it('accepting an insertion keeps the text and strips only that mark', () => {
    const result = resolveSuggestionInDoc(docWithSuggestions(), 'sug-ins', true);

    expect(textOf(result)).toContain('доданий');
    // Formatting the reviewer applied alongside the suggestion must survive.
    expect(marksOf(result, 'доданий').map((m) => m.type)).toEqual(['bold']);
  });

  it('rejecting an insertion removes the text', () => {
    expect(textOf(resolveSuggestionInDoc(docWithSuggestions(), 'sug-ins', false))).not.toContain(
      'доданий'
    );
  });

  it('accepting a deletion removes the text', () => {
    expect(textOf(resolveSuggestionInDoc(docWithSuggestions(), 'sug-del', true))).not.toContain(
      'видалений'
    );
  });

  it('rejecting a deletion restores the text as plain content', () => {
    const result = resolveSuggestionInDoc(docWithSuggestions(), 'sug-del', false);

    expect(textOf(result)).toContain('видалений');
    expect(marksOf(result, 'видалений')).toEqual([]);
  });

  it('leaves other suggestions untouched', () => {
    const result = resolveSuggestionInDoc(docWithSuggestions(), 'sug-ins', true);
    expect(collectSuggestionIds(result)).toEqual([{ id: 'sug-del', kind: 'delete' }]);
  });

  it('never drops unmarked text', () => {
    const result = resolveSuggestionInDoc(docWithSuggestions(), 'sug-ins', false);
    expect(textOf(result)).toContain('звичайний ');
  });
});

describe('resolveAllSuggestionsInDoc', () => {
  it('accept all applies insertions and drops deletions', () => {
    const result = resolveAllSuggestionsInDoc(docWithSuggestions(), true);

    expect(textOf(result)).toBe('звичайний доданий');
    expect(collectSuggestionIds(result)).toEqual([]);
  });

  it('reject all reverts to the original text', () => {
    const result = resolveAllSuggestionsInDoc(docWithSuggestions(), false);

    expect(textOf(result)).toBe('звичайний видалений');
    expect(collectSuggestionIds(result)).toEqual([]);
  });
});
