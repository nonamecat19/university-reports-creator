/**
 * Live document numbering (FR-EDT-07/08): headings, figures, and tables number
 * from document structure, never hand-typed. Computed here (not stored) from
 * the ordered list of sections' ProseMirror JSON, shared by the editor
 * decoration layer and (eventually) the export translator's fixture suite
 * (FR-EXP-02 calls for one counter spec, two implementations).
 */

// ДСТУ 3008:2015 appendix lettering — Ukrainian alphabet excluding
// Ґ, Є, З, І, Ї, Й, О, Ч, Ь (letters easily confused with digits/Latin or
// without a distinct print form in this context).
export const APPENDIX_LETTERS = [
  'А',
  'Б',
  'В',
  'Г',
  'Д',
  'Е',
  'Ж',
  'И',
  'К',
  'Л',
  'М',
  'Н',
  'П',
  'Р',
  'С',
  'Т',
  'У',
  'Ф',
  'Х',
  'Ц',
  'Ш',
  'Щ',
  'Ю',
  'Я',
];

export type SectionKindForNumbering = 'chapter' | 'appendix';

export interface NumberingInput {
  id: string;
  kind: SectionKindForNumbering;
  order: number;
  content: PMNode | null;
}

/** Minimal shape of a ProseMirror JSON node, enough to walk for numbering. */
export interface PMNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
}

export interface NumberingResult {
  /** section id -> chapter number ("2") or appendix letter ("А") */
  sectionLabels: Map<string, string>;
  /** block_id -> computed label ("2.1.3" for a heading, "2.1" for a figure/table) */
  blockNumbers: Map<string, string>;
}

function appendixLabel(index: number): string {
  return APPENDIX_LETTERS[index] ?? `Дод.${index + 1}`;
}

function walk(node: PMNode, fn: (node: PMNode) => void): void {
  fn(node);
  for (const child of node.content ?? []) walk(child, fn);
}

export function computeNumbering(sections: NumberingInput[]): NumberingResult {
  const sectionLabels = new Map<string, string>();
  const blockNumbers = new Map<string, string>();

  let chapterIndex = 0;
  let appendixIndex = 0;

  const ordered = [...sections].sort((a, b) => a.order - b.order);

  for (const section of ordered) {
    const label =
      section.kind === 'appendix' ? appendixLabel(appendixIndex++) : String(++chapterIndex);
    sectionLabels.set(section.id, label);

    if (!section.content) continue;

    const headingCounters = [0, 0, 0]; // heading levels 2, 3, 4
    let figureCounter = 0;
    let tableCounter = 0;

    walk(section.content, (node) => {
      const blockId = node.attrs?.['blockId'] as string | undefined;
      if (!blockId) return;

      if (node.type === 'heading') {
        const level = Number(node.attrs?.['level'] ?? 1);
        if (level < 2 || level > 4) return;
        const idx = level - 2;
        headingCounters[idx]++;
        for (let j = idx + 1; j < headingCounters.length; j++) headingCounters[j] = 0;
        blockNumbers.set(blockId, [label, ...headingCounters.slice(0, idx + 1)].join('.'));
        return;
      }

      if (node.type === 'image') {
        figureCounter++;
        blockNumbers.set(blockId, `${label}.${figureCounter}`);
        return;
      }

      if (node.type === 'table') {
        tableCounter++;
        blockNumbers.set(blockId, `${label}.${tableCounter}`);
      }
    });
  }

  return { sectionLabels, blockNumbers };
}

/** Caption text conventions (FR-EDT-08) — centralized so editor rendering and
 * (later) docx export use identical wording. */
export const captionText = {
  figure: (number: string, caption: string): string =>
    caption ? `Рисунок ${number} — ${caption}` : `Рисунок ${number}`,
  table: (number: string, caption: string): string =>
    caption ? `Таблиця ${number} — ${caption}` : `Таблиця ${number}`,
  sectionLabel: (kind: SectionKindForNumbering, label: string): string =>
    kind === 'appendix' ? `Додаток ${label}` : `Розділ ${label}`,
};
