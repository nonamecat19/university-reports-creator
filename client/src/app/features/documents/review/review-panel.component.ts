import { Component, EventEmitter, Input, inject, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import {
  type Comment,
  CommentFilter,
  type CommentThread,
  ReviewService,
  type Suggestion,
} from '../../../core/services/review.service';

/** What the editor must do when a suggestion is accepted/rejected from here. */
export interface SuggestionResolution {
  suggestionId: string;
  sectionId: string;
  accept: boolean;
}

/**
 * Review tab of the editor's right sidebar (FR-REV-08/10): comment threads
 * with filters, and the pending-suggestion list with accept/reject. Anchoring
 * and content rewriting belong to the editor — this panel only asks for them.
 */
@Component({
  selector: 'app-review-panel',
  standalone: true,
  imports: [FormsModule, TranslatePipe, Button, InputText, Select, Tag],
  template: `
    <div class="review-panel">
      <div class="panel-header">
        <h3>{{ 'review.title' | translate }}</h3>
        @if (review.canComment()) {
          <p-button
            icon="pi pi-comment"
            size="small"
            [text]="true"
            [title]="'review.add_comment' | translate"
            (onClick)="addComment.emit()"
          />
        }
      </div>

      @if (review.isOwner()) {
        <p-button
          [label]="'review.share' | translate"
          icon="pi pi-share-alt"
          size="small"
          [outlined]="true"
          (onClick)="openShare.emit()"
        />
      }

      @if (review.canEdit()) {
        <label class="suggest-toggle">
          <input type="checkbox" [checked]="suggestMode" (change)="toggleSuggestMode.emit()" />
          {{ 'review.suggest_mode' | translate }}
        </label>
      } @else if (review.forcedSuggestMode()) {
        <p class="mode-note">{{ 'review.suggest_mode_forced' | translate }}</p>
      }

      <p-select
        [options]="filterOptions"
        optionLabel="label"
        optionValue="value"
        [ngModel]="review.filter()"
        (ngModelChange)="review.setFilter($event)"
        class="filter-select"
      />

      @if (review.pendingSuggestions().length > 0) {
        <div class="suggestions">
          <h4>
            {{ 'review.suggestions' | translate }} ({{ review.pendingSuggestions().length }})
          </h4>
          @for (suggestion of review.pendingSuggestions(); track suggestion.id) {
            <div class="suggestion-row">
              <span class="suggestion-kind">
                {{ kindLabel(suggestion) }}
                @if (suggestion.authorName) {
                  · {{ suggestion.authorName }}
                }
              </span>
              @if (review.canEdit()) {
                <div class="suggestion-actions">
                  <p-button
                    icon="pi pi-check"
                    size="small"
                    [text]="true"
                    [title]="'review.accept' | translate"
                    (onClick)="resolve(suggestion, true)"
                  />
                  <p-button
                    icon="pi pi-times"
                    size="small"
                    [text]="true"
                    severity="danger"
                    [title]="'review.reject' | translate"
                    (onClick)="resolve(suggestion, false)"
                  />
                </div>
              }
            </div>
          }
          @if (review.canEdit()) {
            <div class="bulk-actions">
              <p-button
                [label]="'review.accept_all' | translate"
                size="small"
                [text]="true"
                (onClick)="bulkResolve.emit(true)"
              />
              <p-button
                [label]="'review.reject_all' | translate"
                size="small"
                [text]="true"
                severity="danger"
                (onClick)="bulkResolve.emit(false)"
              />
            </div>
          }
        </div>
      }

      <div class="threads">
        @for (thread of review.threads(); track thread.root.id) {
          <div
            class="thread"
            [class.resolved]="!!thread.root.resolvedAt"
            [class.orphaned]="thread.root.orphaned"
            (click)="focusComment.emit(thread.root)"
          >
            <div class="thread-head">
              <span class="author">
                {{ thread.root.author === 'ai' ? ('review.ai_author' | translate) : authorLabel(thread.root) }}
              </span>
              @if (thread.root.author === 'ai') {
                <p-tag severity="info" value="AI" />
              }
              @if (thread.root.orphaned) {
                <p-tag severity="warn" [value]="'review.orphaned' | translate" />
              }
            </div>
            @if (thread.root.anchor?.textSnapshot) {
              <blockquote>{{ thread.root.anchor?.textSnapshot }}</blockquote>
            }
            <p class="body">{{ thread.root.body }}</p>

            @for (reply of thread.replies; track reply.id) {
              <div class="reply">
                <span class="author">{{ authorLabel(reply) }}</span>
                <p class="body">{{ reply.body }}</p>
              </div>
            }

            @if (review.canComment()) {
              <div class="thread-actions" (click)="$event.stopPropagation()">
                <input
                  pInputText
                  type="text"
                  [placeholder]="'review.reply_placeholder' | translate"
                  [(ngModel)]="replyDrafts[thread.root.id]"
                  (keydown.enter)="sendReply(thread.root.id)"
                />
                <p-button
                  [label]="
                    thread.root.resolvedAt
                      ? ('review.reopen' | translate)
                      : ('review.resolve' | translate)
                  "
                  size="small"
                  [text]="true"
                  (onClick)="review.resolveComment(thread.root.id, !thread.root.resolvedAt)"
                />
                <p-button
                  icon="pi pi-trash"
                  size="small"
                  [text]="true"
                  severity="danger"
                  (onClick)="review.deleteComment(thread.root.id)"
                />
              </div>
            }
          </div>
        } @empty {
          <p class="empty">{{ 'review.no_comments' | translate }}</p>
        }
      </div>
    </div>
  `,
  styles: `
    .review-panel { display: flex; flex-direction: column; gap: 0.6rem; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; }
    .panel-header h3 { margin: 0; font-size: 0.95rem; }
    .suggest-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; }
    .mode-note { font-size: 0.75rem; color: var(--p-text-muted-color, #6b7280); margin: 0; }
    .filter-select { font-size: 0.8rem; }
    .suggestions h4 { margin: 0.25rem 0; font-size: 0.85rem; }
    .suggestion-row, .bulk-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.25rem;
      font-size: 0.78rem;
    }
    .suggestion-kind { color: var(--p-text-muted-color, #6b7280); }
    .threads { display: flex; flex-direction: column; gap: 0.5rem; }
    .thread {
      border: 1px solid var(--p-content-border-color, #dcdfe4);
      border-radius: 6px;
      padding: 0.5rem;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .thread.resolved { opacity: 0.6; }
    .thread.orphaned { border-color: var(--p-orange-400, #fb923c); }
    .thread-head { display: flex; align-items: center; gap: 0.35rem; }
    .author { font-weight: 600; }
    blockquote {
      margin: 0.3rem 0;
      padding-left: 0.5rem;
      border-left: 2px solid var(--p-primary-300, #93c5fd);
      color: var(--p-text-muted-color, #6b7280);
      font-style: italic;
    }
    .body { margin: 0.25rem 0; white-space: pre-wrap; }
    .reply { margin-left: 0.75rem; padding-left: 0.5rem; border-left: 1px solid var(--p-content-border-color, #dcdfe4); }
    .thread-actions { display: flex; align-items: center; gap: 0.25rem; margin-top: 0.35rem; }
    .thread-actions input { flex: 1; min-width: 0; font-size: 0.75rem; }
    .empty { font-size: 0.78rem; color: var(--p-text-muted-color, #6b7280); }
  `,
})
export class ReviewPanelComponent {
  @Input() suggestMode = false;

  @Output() addComment = new EventEmitter<void>();
  @Output() openShare = new EventEmitter<void>();
  @Output() toggleSuggestMode = new EventEmitter<void>();
  @Output() focusComment = new EventEmitter<Comment>();
  @Output() resolveSuggestion = new EventEmitter<SuggestionResolution>();
  @Output() bulkResolve = new EventEmitter<boolean>();

  protected readonly review = inject(ReviewService);
  protected replyDrafts: Record<string, string> = {};
  protected readonly busy = signal(false);

  protected readonly filterOptions = [
    { value: CommentFilter.OPEN, label: 'Відкриті' },
    { value: CommentFilter.ALL, label: 'Усі' },
    { value: CommentFilter.RESOLVED, label: 'Вирішені' },
    { value: CommentFilter.MINE, label: 'Мої' },
    { value: CommentFilter.AI, label: 'AI' },
  ];

  /** The name captured when the comment was written; falls back to the raw
   * user id for comments written before names were recorded. */
  authorLabel(comment: Comment): string {
    return comment.authorName || comment.author;
  }

  kindLabel(suggestion: Suggestion): string {
    return suggestion.kind === 'delete' ? 'Видалення' : 'Вставка';
  }

  resolve(suggestion: Suggestion, accept: boolean): void {
    this.resolveSuggestion.emit({
      suggestionId: suggestion.suggestionId,
      sectionId: suggestion.sectionId,
      accept,
    });
  }

  async sendReply(threadRootId: string): Promise<void> {
    const body = (this.replyDrafts[threadRootId] ?? '').trim();
    if (!body) return;
    this.replyDrafts[threadRootId] = '';
    await this.review.reply(threadRootId, body);
  }
}

export type { CommentThread };
