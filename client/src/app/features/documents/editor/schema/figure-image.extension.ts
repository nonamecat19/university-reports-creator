import TiptapImage from '@tiptap/extension-image';

/**
 * Image node extended with the fields the editor needs beyond `src` (FR-EDT-05):
 * the MinIO object key (persisted; `src` alone is a transient blob/download URL),
 * natural size for docx EMU sizing at export, and a caption bound to the figure
 * for numbering (FR-EDT-07/08). Caption text itself is edited via the editor
 * toolbar, not inline contenteditable — kept as a plain node attribute.
 */
export const FigureImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      objectKey: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-object-key'),
        renderHTML: (attributes) => {
          if (!attributes['objectKey']) return {};
          return { 'data-object-key': attributes['objectKey'] };
        },
      },
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attributes) => ({ 'data-caption': attributes['caption'] ?? '' }),
      },
      naturalWidth: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-natural-width'),
        renderHTML: (attributes) => ({ 'data-natural-width': attributes['naturalWidth'] }),
      },
      naturalHeight: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-natural-height'),
        renderHTML: (attributes) => ({ 'data-natural-height': attributes['naturalHeight'] }),
      },
    };
  },
});
