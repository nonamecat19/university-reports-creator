import type { AnyExtension } from '@tiptap/core';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { BlockId } from './block-id.extension';
import { CaptionedTable } from './captioned-table.extension';
import { Citation } from './citation.extension';
import { CrossReference } from './cross-reference.extension';
import { FigureImage } from './figure-image.extension';
import { FormulaBlock, FormulaInline } from './formula.extension';
import { Numbering } from './numbering.extension';
import { SuggestionDelete, SuggestionInsert } from './reserved-suggestion-marks.extension';
import { SuggestMode } from './suggest-mode.extension';

/**
 * Section editor schema (FR-EDT-04): blocks + marks representable in docx.
 * No font-family/size/color marks — typography comes from the template's
 * styles at export, the editor only edits structure and content.
 *
 * Deferred to later phases (not in this schema yet): footnotes.
 */
export function buildSectionExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      // Suggestion marks are reserved separately below; StarterKit's
      // `link` isn't part of the FR-EDT-04 schema, so it's left out.
    }),
    Underline,
    Subscript,
    Superscript,
    FigureImage.configure({ inline: false }),
    CaptionedTable.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Citation,
    CrossReference,
    FormulaBlock,
    FormulaInline,
    BlockId,
    Numbering,
    SuggestionInsert,
    SuggestionDelete,
    SuggestMode,
  ];
}
