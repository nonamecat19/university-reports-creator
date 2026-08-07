---
name: document-editor
description: "TipTap/ProseMirror document editor patterns for this project. Use when working on client/src/app/features/documents/editor — custom TipTap extensions, live section/figure/table numbering, block IDs, autosave, or the section-per-editor architecture. This is the editing engine behind the DSTU-formatted document output; pair with the dstu-formatting skill for the numbering/labeling rules it implements."
---

# Document Editor Patterns

Architecture and coding patterns for the section-based TipTap editor (`client/src/app/features/documents/editor/`). Follow these exactly when touching the editor schema, numbering, or autosave.

## Layout

```
features/documents/editor/
  document-editor.component.ts   # top-level: owns document + all sections, revision tracking
  section-editor.component.ts    # one TipTap Editor instance per section, toolbar, autosave
  numbering.ts                    # computeNumbering() — pure function, no DOM/editor dependency
  word-count.ts
  document-content.util.ts
  schema/
    extensions.ts                  # buildSectionExtensions() — the one schema definition
    block-id.extension.ts           # stamps stable UUIDs on top-level blocks
    numbering.extension.ts           # ProseMirror decoration layer, consumes numbering.ts output
    captioned-table.extension.ts      # table + caption attribute
    figure-image.extension.ts          # image node with caption + natural size
    reserved-suggestion-marks.extension.ts  # review-mode marks, reserved but unused (see below)
```

## One Editor Instance Per Section (FR-EDT-03)

`DocumentEditorComponent` owns the document and its list of sections; `SectionEditorComponent` wraps exactly one TipTap `Editor` for one section. This keeps documents scalable and maps 1:1 to template regions — never merge all sections into a single editor instance, and never let `SectionEditorComponent` reach outside its own section (it takes `initialContent`/`numberingMap` as `@Input()`s and emits `dirty`/`save`, nothing else).

```typescript
private createEditor(): void {
  this.editor = new Editor({
    element: this.editorHost.nativeElement,
    extensions: buildSectionExtensions(),
    content: this.initialContent ?? '',
    editable: this.editable,
    onUpdate: () => {
      this.dirty.emit(this.editor.getJSON());   // cheap, every keystroke — live numbering only
      this.scheduleSave();                        // debounced — the actual autosave payload
    },
  });
}
```

## Schema Rules (FR-EDT-04)

`buildSectionExtensions()` in `schema/extensions.ts` is the single source of truth for what the editor can represent — it must match what the docx export translator can produce. Current rule: **no font-family/size/color marks** — typography comes from the template's styles at export time; the editor only edits structure and content. Don't add a color/font-size button or extension without updating the export translator in the same change.

Deferred (documented in a comment, not yet implemented): footnotes. Check that comment before assuming a feature is missing vs. intentionally out of scope.

Citations, cross-references and formulas share one design: the node stores **only a reference** (`sourceId` / `targetId` / `latex`), and everything visible — the number, the wording, the rendered maths — is derived at display time from `numbering.ts` (editor) or `numbering.py` + `omml.py` (export). Never store a rendered label in a node; it will go stale.

## Custom Extensions

### BlockId — stable identity for every top-level block

```typescript
export const BLOCK_ID_NODE_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'image', 'codeBlock', 'horizontalRule'];

export const BlockId = Extension.create({
  name: 'blockId',
  addGlobalAttributes() { /* data-block-id attr on BLOCK_ID_NODE_TYPES */ },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        // walk newState.doc; any block missing an id, or reusing a seen id
        // (copy-paste duplication), gets a fresh crypto.randomUUID()
      },
    })];
  },
});
```

Comment anchors, cross-references, and the future suggestion registry all target `blockId`, never ProseMirror positions (positions shift on every edit; block IDs survive). When adding a new block-level node type that needs to be addressable, add it to `BLOCK_ID_NODE_TYPES`.

### Numbering — two-layer split (pure logic vs. rendering)

`numbering.ts` (`computeNumbering()`) is a **pure function** with no editor/DOM dependency: `NumberingInput[]` (section id/kind/order/ProseMirror-JSON content) in, `{ sectionLabels, blockNumbers }` maps out. This is deliberate (see file header comment: "one counter spec, two implementations") — it's shared conceptually by the live editor decoration layer and, eventually, the docx export translator's fixture suite, so keep numbering logic here rather than inline in a TipTap extension.

`schema/numbering.extension.ts` is the ProseMirror decoration layer that *renders* the maps `computeNumbering()` produces (via `editor.state.tr.setMeta(numberingPluginKey, numberingMap)`, dispatched from `SectionEditorComponent.pushNumbering()` whenever `@Input() numberingMap` changes) — it holds no counting logic itself.

Numbering rules implemented in `computeNumbering()` (DSTU 3008:2015 — see the `dstu-formatting` skill for the full spec):
- Chapters number sequentially (`1`, `2`, ...); appendices get Ukrainian letters from `APPENDIX_LETTERS` (a curated subset excluding letters easily confused with digits/Latin), independent counters.
- Headings number per-section as `<section>.<h2>.<h3>.<h4>`, with deeper levels resetting when a shallower one increments (`headingCounters[idx]++; for j > idx: headingCounters[j] = 0`).
- Figures and tables each get their own per-section counter (`<section>.<n>`), separate from heading numbers.
- `captionText.figure()` / `captionText.table()` / `captionText.sectionLabel()` centralize the Ukrainian caption wording (`Рисунок N — caption`, `Таблиця N — caption`, `Розділ N` / `Додаток L`) — editor rendering and export must use these, not ad-hoc string templates, so wording never drifts between the two.

### CaptionedTable / FigureImage — extend, don't reimplement

Both extend a stock TipTap/ProseMirror extension via `.extend({ addAttributes() { return { ...this.parent?.(), caption: {...} } } })` rather than building a custom table/image node from scratch. Follow this pattern for any similar "stock node + one extra attribute" need — always spread `this.parent?.()` first so you don't drop the base extension's attributes.

### Reserved Suggestion Marks — schema-first for a future feature

`SuggestionInsert`/`SuggestionDelete` marks are defined and included in `buildSectionExtensions()` from P2 specifically so review mode (a later phase, FR-REV-09..11) never needs a content-migration when it lands — they render (`<ins data-suggestion-id>` / `<del data-suggestion-id>`) but nothing currently applies them via a command. If you're implementing review-mode authoring, wire commands to these existing marks rather than adding new ones.

## Autosave & Concurrency

`SectionEditorComponent` only debounces (`AUTOSAVE_DEBOUNCE_MS = 2000`) and emits `save`; it does not call the RPC itself. `DocumentEditorComponent` owns the actual `documentService.updateSection()` call and the `sectionRevision` optimistic-concurrency counter (FR-EDT-09) — a stale write throws `FAILED_PRECONDITION`, and the recovery path reloads just that section and calls `SectionEditorComponent.setContent()` (which uses `emitUpdate: false` to avoid re-triggering `onUpdate`/autosave). Keep this split: revision/conflict handling belongs in the parent, never inside the per-section component.

`flushNow()` bypasses the debounce for explicit saves (Ctrl+S) — call it instead of waiting out the timer for user-initiated saves.

## Images

`onImagePicked()` shows a local `URL.createObjectURL(file)` immediately (so the image appears without waiting on the network), reads natural dimensions client-side, then uploads via `FileService` and sets `objectKey` on the node once the upload resolves. Don't block the UI on the upload before showing the image.
