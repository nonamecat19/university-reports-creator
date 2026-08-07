import {
  captionText,
  collectReferenceTargets,
  computeNumbering,
  type NumberingInput,
  referenceLabels,
} from './numbering';

/**
 * FR-EXP-02 requires one counter spec with two implementations (here and
 * service-render's `numbering.py`). These cases mirror
 * `service-render/tests/test_formulas.py::TestFormulaNumbering` so a change on
 * one side that is not mirrored on the other fails a build.
 */
function section(
  id: string,
  kind: 'chapter' | 'appendix',
  order: number,
  nodes: object[]
): NumberingInput {
  return { id, kind, order, content: { type: 'doc', content: nodes } };
}

function formula(blockId: string): object {
  return { type: 'formulaBlock', attrs: { blockId, latex: 'x' } };
}

describe('computeNumbering', () => {
  it('numbers display formulas per chapter', () => {
    const { blockNumbers } = computeNumbering([
      section('s1', 'chapter', 0, [
        formula('f1'),
        { type: 'paragraph', attrs: { blockId: 'p1' } },
        formula('f2'),
      ]),
      section('s2', 'chapter', 1, [formula('f3')]),
    ]);

    expect(blockNumbers.get('f1')).toBe('1.1');
    expect(blockNumbers.get('f2')).toBe('1.2');
    expect(blockNumbers.get('f3')).toBe('2.1');
  });

  it('numbers formulas inside an appendix with the appendix letter', () => {
    const { blockNumbers } = computeNumbering([section('a1', 'appendix', 0, [formula('f1')])]);
    expect(blockNumbers.get('f1')).toBe('А.1');
  });

  it('counts figures, tables and formulas independently', () => {
    const { blockNumbers } = computeNumbering([
      section('s1', 'chapter', 0, [
        { type: 'image', attrs: { blockId: 'i1' } },
        formula('f1'),
        { type: 'table', attrs: { blockId: 't1' } },
      ]),
    ]);

    expect(blockNumbers.get('i1')).toBe('1.1');
    expect(blockNumbers.get('f1')).toBe('1.1');
    expect(blockNumbers.get('t1')).toBe('1.1');
  });

  it('renders formula numbers in parentheses', () => {
    expect(captionText.formula('2.3')).toBe('(2.3)');
  });
});

describe('referenceLabels', () => {
  /** Mirrors service-render's TestCrossReferenceExport.test_reference_labels_*
   * so the two implementations of the wording cannot drift. */
  const result = computeNumbering([
    section('s1', 'chapter', 0, [
      { type: 'heading', attrs: { blockId: 'h1', level: 2 } },
      { type: 'image', attrs: { blockId: 'i1', caption: 'Схема' } },
      { type: 'table', attrs: { blockId: 't1', caption: 'Дані' } },
      { type: 'formulaBlock', attrs: { blockId: 'f1', latex: 'x^2' } },
    ]),
    { id: 'a1', kind: 'appendix', order: 1, title: 'Лістинг', content: null },
  ]);

  it('renders the short reference form for every numbered kind', () => {
    const labels = referenceLabels(result);

    expect(labels.get('h1')).toBe('розд. 1.1');
    expect(labels.get('i1')).toBe('рис. 1.1');
    expect(labels.get('t1')).toBe('табл. 1.1');
    expect(labels.get('f1')).toBe('(1.1)');
    expect(labels.get('s1')).toBe('розділ 1');
    expect(labels.get('a1')).toBe('додаток А');
  });

  it('leaves a deleted target unresolved', () => {
    expect(referenceLabels(result).get('gone')).toBeUndefined();
  });
});

describe('collectReferenceTargets', () => {
  it('lists sections and their numbered blocks in document order', () => {
    const input: NumberingInput[] = [
      {
        id: 's1',
        kind: 'chapter',
        order: 0,
        title: 'Вступ',
        content: {
          type: 'doc',
          content: [
            { type: 'image', attrs: { blockId: 'i1', caption: 'Схема системи' } },
            { type: 'paragraph', attrs: { blockId: 'p1' } },
          ],
        },
      },
    ];
    const targets = collectReferenceTargets(input, computeNumbering(input));

    expect(targets.map((t) => t.id)).toEqual(['s1', 'i1']);
    expect(targets[1].label).toBe('рис. 1.1');
    expect(targets[1].description).toBe('Схема системи');
  });
});
