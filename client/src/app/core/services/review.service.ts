import { computed, Injectable, inject, signal } from '@angular/core';
import type { Comment, CommentAnchor, Share, Suggestion } from '@gen/document/document';
import { CommentFilter, Role } from '@gen/document/document';
import { DocumentServiceClient } from '@gen/document/document.client';
import { grpcTransport } from '../grpc/transport';
import { AuthService } from './auth.service';

export type { Comment, CommentAnchor, Share, Suggestion };
export { CommentFilter, Role };

/** A comment thread: root plus its replies, in creation order. */
export interface CommentThread {
  root: Comment;
  replies: Comment[];
}

/**
 * Review state for the open document (07-review-mode.md): shares, comment
 * threads, the suggestion registry and unread badges. Like SourceService this
 * is per-document — `load(documentId)` swaps everything.
 */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly client = new DocumentServiceClient(grpcTransport);
  private readonly auth = inject(AuthService);

  private readonly _documentId = signal('');
  private readonly _comments = signal<Comment[]>([]);
  private readonly _suggestions = signal<Suggestion[]>([]);
  private readonly _shares = signal<Share[]>([]);
  private readonly _filter = signal<CommentFilter>(CommentFilter.OPEN);
  private readonly _myRole = signal<Role>(Role.VIEWER);
  private readonly _unreadComments = signal(0);
  private readonly _unreadSuggestions = signal(0);

  readonly comments = this._comments.asReadonly();
  readonly suggestions = this._suggestions.asReadonly();
  readonly shares = this._shares.asReadonly();
  readonly filter = this._filter.asReadonly();
  readonly myRole = this._myRole.asReadonly();
  readonly unreadComments = this._unreadComments.asReadonly();
  readonly unreadSuggestions = this._unreadSuggestions.asReadonly();

  /** Roles are ordered most- to least-privileged in the proto enum, so
   * "at least X" is `role <= X` (mirrors the server's check). */
  readonly canComment = computed(
    () => this._myRole() !== Role.UNSPECIFIED && this._myRole() <= Role.COMMENTER
  );
  readonly canEdit = computed(
    () => this._myRole() !== Role.UNSPECIFIED && this._myRole() <= Role.EDITOR
  );
  readonly isOwner = computed(() => this._myRole() === Role.OWNER);

  /** Commenters are forced into suggest mode; owners/editors toggle it
   * (FR-REV-09). */
  readonly forcedSuggestMode = computed(() => this._myRole() === Role.COMMENTER);

  readonly threads = computed<CommentThread[]>(() => {
    const all = this._comments();
    const roots = all.filter((c) => !c.threadRootId);
    return roots.map((root) => ({
      root,
      replies: all.filter((c) => c.threadRootId === root.id),
    }));
  });

  readonly pendingSuggestions = computed(() =>
    this._suggestions().filter((s) => s.status === 'pending')
  );

  /** blockId → open threads anchored on it, for in-text highlighting. */
  readonly threadsByBlock = computed(() => {
    const map = new Map<string, CommentThread[]>();
    for (const thread of this.threads()) {
      const blockId = thread.root.anchor?.blockId;
      if (!blockId || thread.root.orphaned) continue;
      const list = map.get(blockId) ?? [];
      list.push(thread);
      map.set(blockId, list);
    }
    return map;
  });

  setRole(role: Role): void {
    this._myRole.set(role);
  }

  setFilter(filter: CommentFilter): void {
    this._filter.set(filter);
    void this.loadComments();
  }

  async load(documentId: string, role: Role): Promise<void> {
    this._documentId.set(documentId);
    this._myRole.set(role);
    await Promise.all([this.loadComments(), this.loadSuggestions(), this.loadUnread()]);
    if (role === Role.OWNER) await this.loadShares();
  }

  async loadComments(): Promise<void> {
    const documentId = this._documentId();
    if (!documentId) return;
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.listComments({ documentId, filter: this._filter() }).response
    );
    this._comments.set(resp.comments);
  }

  async loadSuggestions(): Promise<void> {
    const documentId = this._documentId();
    if (!documentId) return;
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.listSuggestions({ documentId }).response
    );
    this._suggestions.set(resp.suggestions);
  }

  async loadShares(): Promise<void> {
    const documentId = this._documentId();
    if (!documentId) return;
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.listShares({ documentId }).response
    );
    this._shares.set(resp.shares);
  }

  async loadUnread(): Promise<void> {
    const documentId = this._documentId();
    if (!documentId) return;
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.getUnreadCounts({ documentId }).response
    );
    this._unreadComments.set(resp.comments);
    this._unreadSuggestions.set(resp.suggestions);
  }

  /** Clears the badges by moving this user's read cursor (FR-REV-14). */
  async markRead(): Promise<void> {
    const documentId = this._documentId();
    if (!documentId) return;
    await this.auth.callWithAuthRetry(() => this.client.markRead({ documentId }).response);
    this._unreadComments.set(0);
    this._unreadSuggestions.set(0);
  }

  async createComment(sectionId: string, anchor: CommentAnchor, body: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () =>
        this.client.createComment({
          documentId: this._documentId(),
          sectionId,
          anchor,
          body,
          aiCategory: '',
        }).response
    );
    await this.loadComments();
  }

  /**
   * Replaces the previous analysis run's AI comments with this run's findings
   * (FR-AI-09). Re-running analysis must not pile up duplicates, so the server
   * keeps findings it already has, adds the new ones, and resolves the ones
   * this run no longer reports.
   */
  async syncAiComments(
    findings: Array<{
      sectionId: string;
      aiCategory: string;
      body: string;
      anchor?: CommentAnchor;
    }>
  ): Promise<{ created: number; kept: number; resolved: number }> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.syncAiComments({
          documentId: this._documentId(),
          findings: findings.map((f) => ({
            sectionId: f.sectionId,
            aiCategory: f.aiCategory,
            body: f.body,
            anchor: f.anchor,
          })),
        }).response
    );
    await this.loadComments();
    return { created: resp.created.length, kept: resp.kept, resolved: resp.resolved };
  }

  async reply(threadRootId: string, body: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () =>
        this.client.replyComment({ documentId: this._documentId(), threadRootId, body }).response
    );
    await this.loadComments();
  }

  async resolveComment(commentId: string, resolved: boolean): Promise<void> {
    await this.auth.callWithAuthRetry(
      () =>
        this.client.resolveComment({ documentId: this._documentId(), commentId, resolved }).response
    );
    await this.loadComments();
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () => this.client.deleteComment({ documentId: this._documentId(), commentId }).response
    );
    await this.loadComments();
  }

  /** Records suggestion ids the editor just wrote into a section's content
   * (FR-REV-11) — content stays the source of truth, this keeps the registry
   * in step. */
  async registerSuggestions(
    sectionId: string,
    suggestionIds: string[],
    kind: string
  ): Promise<void> {
    if (suggestionIds.length === 0) return;
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.registerSuggestions({
          documentId: this._documentId(),
          sectionId,
          suggestionIds,
          kind,
        }).response
    );
    this._suggestions.set(resp.suggestions);
  }

  /** Accept/reject one suggestion. `contentJson` is the section content after
   * the client applied the resolution, sent with its revision (FR-EDT-09). */
  async resolveSuggestion(
    suggestionId: string,
    accept: boolean,
    sectionId: string,
    contentJson: string,
    sectionRevision: number
  ): Promise<{ suggestions: Suggestion[]; sectionRevision: number }> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.resolveSuggestion({
          documentId: this._documentId(),
          suggestionId,
          accept,
          sectionId,
          contentJson,
          sectionRevision,
        }).response
    );
    await this.loadSuggestions();
    return {
      suggestions: this._suggestions(),
      sectionRevision: resp.section?.revision ?? sectionRevision,
    };
  }

  async bulkResolveSuggestions(
    accept: boolean,
    sectionId: string,
    contentJson: string,
    sectionRevision: number
  ): Promise<number> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.bulkResolveSuggestions({
          documentId: this._documentId(),
          sectionId,
          accept,
          contentJson,
          sectionRevision,
        }).response
    );
    this._suggestions.set(resp.suggestions);
    return resp.section?.revision ?? sectionRevision;
  }

  async shareByEmail(email: string, role: Role): Promise<Share | undefined> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.shareByEmail({ documentId: this._documentId(), email, role }).response
    );
    await this.loadShares();
    return resp.share;
  }

  async createShareLink(role: Role): Promise<Share | undefined> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.createShareLink({ documentId: this._documentId(), role }).response
    );
    await this.loadShares();
    return resp.share;
  }

  async revokeShare(shareId: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () => this.client.revokeShare({ documentId: this._documentId(), shareId }).response
    );
    await this.loadShares();
  }

  /** Claims a share link for the signed-in account (FR-REV-03). */
  async acceptShareLink(token: string): Promise<{ documentId: string; role: Role }> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.acceptShareLink({ token }).response
    );
    return { documentId: resp.documentId, role: resp.role };
  }
}

/** Builds the share URL handed to a reviewer (FR-REV-02). */
export function shareLinkUrl(documentId: string, token: string): string {
  return `${window.location.origin}/d/${documentId}?token=${encodeURIComponent(token)}`;
}
