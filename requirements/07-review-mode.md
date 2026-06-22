# 07 — Review Mode: Sharing, Comments, Suggestions

## Purpose

Asynchronous Google-Docs-like review: the student shares the document with a supervisor, who comments on anchored ranges and proposes edits as suggestions the student accepts or rejects. No real-time co-editing (explicitly out of scope). Suggestions export as native Word track changes.

## Roles & sharing

- **FR-REV-01** Per-document access roles:
  - `owner` — the student; full control incl. sharing and export;
  - `editor` — direct edits + comments + suggestions (for a co-author scenario);
  - `commenter` — read + comment + suggest (the supervisor default);
  - `viewer` — read only.
- **FR-REV-02** Sharing channels:
  - **email invite**: enter email + role; if the email has an account, the document appears in their "Shared with me" list; if not, they receive the link flow below (email sending is P-later — MVP shows a copyable invite link after entering the email, binding the invite to that email at first accept);
  - **share link**: generate a link `https://<app>/d/<doc_id>?token=<link_token>` bound to a role. Opening it while signed in grants that account the role; link can be revoked/regenerated. `link_token` ≥ 128 bits entropy ([12-non-functional.md](12-non-functional.md)).
- **FR-REV-03** Reviewers MUST have an account (registration via the link flow is streamlined: Google sign-in one click). Anonymous commenting is out of scope — accountability of review authorship matters for accept/reject and export attribution.
- **FR-REV-04** Sharing management dialog: list of people+roles, change role, remove, link settings. Access checks enforced in the gateway/service-document on every RPC (owner-only: share management, export settings, delete).

## Comments

- **FR-REV-05** A comment anchors to `{block_id, offset_range, text_snapshot}` — the stable block UUID from FR-EDT-04 plus an intra-block character range and the anchored text snapshot. Threads: root comment + replies, author + timestamp each. Emoji-free plain text + basic formatting (bold/italic/links) is sufficient.
- **FR-REV-06** Anchor resilience: block moves/reorders and edits elsewhere in the document never affect an anchor (block_id is stable). Within a block, live edits re-map offsets via ProseMirror position mapping; offline divergence repairs offsets by fuzzy-matching the text snapshot inside that block only. A deleted block degrades its comments to "orphaned", listed at section level — never dropped.
- **FR-REV-07** Comment lifecycle: open → resolved (by anyone with commenter+; shows resolver) → reopenable. Resolved comments hidden by default, filterable. Deleting: authors delete own comments; owner can delete any.
- **FR-REV-08** Comments UI: right-panel list (filter: all/open/resolved/mine/AI) + inline highlight in text; clicking either side focuses both. AI-generated analysis comments ([08-ai.md](08-ai.md)) appear in the same system with an `ai` author badge.

## Suggestions (track changes)

- **FR-REV-09** Users with role `commenter`+ operate in **suggest mode** (commenters are forced into it; editors/owner can toggle). In suggest mode every edit becomes a suggestion instead of a direct change: insertions render as marked-inserted text, deletions as struck-through retained text — implemented via ProseMirror suggestion marks (insertion/deletion marks carrying author + timestamp + suggestion id), the established "suggest edits" plugin pattern.
- **FR-REV-10** Each suggestion is individually **accept**able / **reject**able by the owner (and editors): accept applies the change and strips marks; reject reverts. Bulk "accept all / reject all in section". A discussion thread can hang off a suggestion (same comment machinery).
- **FR-REV-11** Suggestions are stored inside section content (marks) with a suggestion registry per document for listing/counters; a version snapshot is taken before any bulk accept (FR-EDT-10).
- **FR-REV-12** Scope limits: suggestions cover text edits and inline formatting. Structural operations (table column changes, image swap, section reorder) are NOT suggestible — reviewer leaves a comment instead. Enforced by blocking those actions in suggest mode with a hint.
- **FR-REV-13** **Export as Word track changes**: on export, pending suggestions map to native OOXML revisions — insertion marks → `w:ins`, deletion marks → `w:del` with author and date attributes — so the supervisor sees real track changes when opening the exported docx in Word. Export dialog offers: export clean (pending suggestions rejected in output), export accepted (all applied), export with track changes (default when suggestions pending). Comments likewise export as native Word comments (`w:comment` + range refs) when "with track changes" is selected.

## Notifications

- **FR-REV-14** MVP: in-app only — badge counts on "Shared with me" and per-document (new comments/suggestions since last visit, per-user read cursors). Email notifications P-later.

## Acceptance criteria

- Owner shares via link with `commenter`; second account opens link, gets access, comments, and makes suggestions; owner sees badges, accepts one suggestion and rejects another; content reflects exactly that.
- Comment anchors survive: owner edits/reorders paragraphs around an anchored block; comment stays attached (block_id stable); a deleted anchored block produces an orphaned (not lost) comment.
- Export "with track changes" of a doc with pending suggestions + comments opens in MS Word showing native tracked insertions/deletions with correct authorship and comment bubbles.
- A viewer-role account cannot comment or suggest (UI hidden AND RPC rejected).

## Open questions

- Should `editor` role exist in MVP or is owner+commenter enough? (Kept in model — cheap; UI may expose only viewer/commenter initially.)
