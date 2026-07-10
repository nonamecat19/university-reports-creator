import type { PMNode } from './numbering';

/** FR-EDT-11: word count / page estimate per section and total. Page count is
 * an estimate (labeled as such in the UI) — true pagination happens at export
 * preview (09-export.md), not here. */

interface TextPMNode extends PMNode {
  text?: string;
}

const AVERAGE_WORDS_PER_PAGE = 300;

export function countWords(content: PMNode | null | undefined): number {
  if (!content) return 0;
  let text = '';
  const walk = (node: TextPMNode): void => {
    if (node.text) text += `${node.text} `;
    for (const child of node.content ?? []) walk(child);
  };
  walk(content);
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function estimatePages(wordCount: number): number {
  return wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / AVERAGE_WORDS_PER_PAGE));
}
