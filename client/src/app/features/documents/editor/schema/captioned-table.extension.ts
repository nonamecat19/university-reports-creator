import TiptapTable from '@tiptap/extension-table';

/**
 * Table node extended with a caption bound above it for numbering (FR-TBL-04,
 * FR-EDT-08). Full docx column-width/page-break mapping is out of scope here
 * (05-tables.md, a later pass) — this only covers editor-side authoring.
 */
export const CaptionedTable = TiptapTable.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attributes) => ({ 'data-caption': attributes['caption'] ?? '' }),
      },
    };
  },
});
