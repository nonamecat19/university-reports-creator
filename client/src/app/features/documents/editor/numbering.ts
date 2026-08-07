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
  /** Only used to describe the section in the cross-reference picker. */
  title?: string;
}

/** Minimal shape of a ProseMirror JSON node, enough to walk for numbering. */
export interface PMNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
}

/** What a numbered block *is*, so a cross-reference can pick its wording
 * («рис. 2.1» vs «табл. 2.1») without the reference node storing it — a stored
 * kind would go stale the moment the target changed. */
export type NumberedKind = 'heading' | 'figure' | 'table' | 'formula';

export interface NumberingResult {
  /** section id -> chapter number ("2") or appendix letter ("А") */
  sectionLabels: Map<string, string>;
  /** section id -> chapter | appendix, for section-level reference wording */
  sectionKinds: Map<string, SectionKindForNumbering>;
  /** block_id -> computed label ("2.1.3" for a heading, "2.1" for a figure/table) */
  blockNumbers: Map<string, string>;
  /** block_id -> what that block is (FR-EDT-04 cross-references) */
  blockKinds: Map<string, NumberedKind>;
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
  const sectionKinds = new Map<string, SectionKindForNumbering>();
  const blockNumbers = new Map<string, string>();
  const blockKinds = new Map<string, NumberedKind>();

  const record = (blockId: string, number: string, kind: NumberedKind): void => {
    blockNumbers.set(blockId, number);
    blockKinds.set(blockId, kind);
  };

  let chapterIndex = 0;
  let appendixIndex = 0;

  const ordered = [...sections].sort((a, b) => a.order - b.order);

  for (const section of ordered) {
    const label =
      section.kind === 'appendix' ? appendixLabel(appendixIndex++) : String(++chapterIndex);
    sectionLabels.set(section.id, label);
    sectionKinds.set(section.id, section.kind);

    if (!section.content) continue;

    const headingCounters = [0, 0, 0]; // heading levels 2, 3, 4
    let figureCounter = 0;
    let tableCounter = 0;
    let formulaCounter = 0;

    walk(section.content, (node) => {
      const blockId = node.attrs?.['blockId'] as string | undefined;
      if (!blockId) return;

      if (node.type === 'heading') {
        const level = Number(node.attrs?.['level'] ?? 1);
        if (level < 2 || level > 4) return;
        const idx = level - 2;
        headingCounters[idx]++;
        for (let j = idx + 1; j < headingCounters.length; j++) headingCounters[j] = 0;
        record(blockId, [label, ...headingCounters.slice(0, idx + 1)].join('.'), 'heading');
        return;
      }

      if (node.type === 'image') {
        figureCounter++;
        record(blockId, `${label}.${figureCounter}`, 'figure');
        return;
      }

      if (node.type === 'table') {
        tableCounter++;
        record(blockId, `${label}.${tableCounter}`, 'table');
        return;
      }

      if (node.type === 'formulaBlock') {
        formulaCounter++;
        record(blockId, `${label}.${formulaCounter}`, 'formula');
      }
    });
  }

  return { sectionLabels, sectionKinds, blockNumbers, blockKinds };
}

/** Caption text conventions (FR-EDT-08) — centralized so editor rendering and
 * (later) docx export use identical wording. */
export const captionText = {
  figure: (number: string, caption: string): string =>
    caption ? `Рисунок ${number} — ${caption}` : `Рисунок ${number}`,
  table: (number: string, caption: string): string =>
    caption ? `Таблиця ${number} — ${caption}` : `Таблиця ${number}`,
  /** Formula numbers are bare parenthesised counters, right-aligned on the
   * formula's line (ДСТУ 3008:2015). */
  formula: (number: string): string => `(${number})`,
  sectionLabel: (kind: SectionKindForNumbering, label: string): string =>
    kind === 'appendix' ? `Додаток ${label}` : `Розділ ${label}`,
};

/** In-text cross-reference wording (FR-EDT-04/07). Short forms, per Ukrainian
 * academic practice: a caption reads «Рисунок 2.1 — …», a reference to it
 * reads «рис. 2.1». */
export const referenceText = {
  heading: (number: string): string => `розд. ${number}`,
  figure: (number: string): string => `рис. ${number}`,
  table: (number: string): string => `табл. ${number}`,
  formula: (number: string): string => `(${number})`,
  section: (kind: SectionKindForNumbering, label: string): string =>
    kind === 'appendix' ? `додаток ${label}` : `розділ ${label}`,
  /** Shown when the referenced block was deleted — the same orphan signal
   * citations use, and it blocks export. */
  unresolved: '[?]',
};

/**
 * Rendered label for every referenceable target, keyed by the id a
 * cross-reference node stores. Cross-references keep only that id: the wording
 * and the number are both derived, so moving or renumbering a figure updates
 * every reference to it without touching stored content (FR-EDT-07).
 */
export function referenceLabels(result: NumberingResult): Map<string, string> {
  const labels = new Map<string, string>();

  for (const [blockId, number] of result.blockNumbers) {
    const kind = result.blockKinds.get(blockId);
    if (kind) labels.set(blockId, referenceText[kind](number));
  }
  for (const [sectionId, label] of result.sectionLabels) {
    labels.set(
      sectionId,
      referenceText.section(result.sectionKinds.get(sectionId) ?? 'chapter', label)
    );
  }

  return labels;
}

/** One entry in the "insert cross-reference" picker. */
export interface ReferenceTarget {
  /** block id, or section id for a whole section */
  id: string;
  kind: NumberedKind | 'section';
  /** what the reference will render as, e.g. «рис. 2.1» */
  label: string;
  /** caption / heading text, so the picker is readable */
  description: string;
}

function inlineText(node: PMNode): string {
  return (node.text ?? '') + (node.content ?? []).map(inlineText).join('');
}

/** Everything a student can point a cross-reference at, in document order. */
export function collectReferenceTargets(
  sections: NumberingInput[],
  result: NumberingResult
): ReferenceTarget[] {
  const targets: ReferenceTarget[] = [];
  const ordered = [...sections].sort((a, b) => a.order - b.order);

  for (const section of ordered) {
    const sectionLabel = result.sectionLabels.get(section.id);
    if (sectionLabel) {
      targets.push({
        id: section.id,
        kind: 'section',
        label: referenceText.section(section.kind, sectionLabel),
        description: section.title ?? '',
      });
    }
    if (!section.content) continue;

    walk(section.content, (node) => {
      const blockId = node.attrs?.['blockId'] as string | undefined;
      if (!blockId) return;
      const kind = result.blockKinds.get(blockId);
      const number = result.blockNumbers.get(blockId);
      if (!kind || !number) return;

      const caption = (node.attrs?.['caption'] as string) ?? '';
      const description =
        kind === 'heading'
          ? inlineText(node)
          : kind === 'formula'
            ? ((node.attrs?.['latex'] as string) ?? '')
            : caption;

      targets.push({ id: blockId, kind, label: referenceText[kind](number), description });
    });
  }

  return targets;
}
