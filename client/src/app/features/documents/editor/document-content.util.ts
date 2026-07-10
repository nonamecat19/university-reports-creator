import type { FileService } from '../../../core/services/file.service';
import type { PMNode } from './numbering';

// A doc with zero child blocks renders nothing clickable — TipTap needs at
// least one (empty) paragraph to give the user a caret to click into.
const EMPTY_DOC: PMNode = { type: 'doc', content: [{ type: 'paragraph' }] };

export function parseSectionContent(contentJson: string): PMNode {
  if (!contentJson) return structuredClone(EMPTY_DOC);
  try {
    const parsed = JSON.parse(contentJson) as PMNode;
    // A brand-new section is created server-side with content: {} (no `type`
    // field) rather than a proper empty ProseMirror doc — TipTap rejects that.
    return parsed.type === 'doc' ? parsed : structuredClone(EMPTY_DOC);
  } catch {
    return structuredClone(EMPTY_DOC);
  }
}

/** Images persist only the MinIO object key (FR-EDT-05); `src` is only ever a
 * transient blob URL for the current session, so it must be re-resolved via
 * FileService on every load. */
export async function hydrateImages(content: PMNode, fileService: FileService): Promise<PMNode> {
  const clone = structuredClone(content) as PMNode & { attrs?: Record<string, unknown> };
  const pending: Promise<void>[] = [];

  const walk = (node: PMNode & { attrs?: Record<string, unknown> }): void => {
    if (node.type === 'image' && node.attrs?.['objectKey']) {
      const objectKey = node.attrs['objectKey'] as string;
      pending.push(
        fileService
          .downloadAsObjectUrl(objectKey)
          .then((url) => {
            node.attrs = { ...node.attrs, src: url };
          })
          .catch(() => {
            node.attrs = { ...node.attrs, src: '' };
          })
      );
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(clone);

  await Promise.all(pending);
  return clone;
}
