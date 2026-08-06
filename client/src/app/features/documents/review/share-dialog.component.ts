import { Component, Input, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { ReviewService, Role, shareLinkUrl } from '../../../core/services/review.service';

/**
 * Sharing management (FR-REV-02/04): email invites, link generation, role
 * changes by re-invite, and revocation. Email delivery is P-later, so an
 * invite yields a copyable link bound to that address at first accept.
 */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  imports: [FormsModule, TranslatePipe, Button, Dialog, InputText, Select, Tag],
  template: `
    <p-dialog
      [header]="'review.share_dialog' | translate"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '32rem' }"
    >
      <div class="invite-row">
        <input
          pInputText
          type="email"
          [(ngModel)]="email"
          [placeholder]="'review.email_placeholder' | translate"
        />
        <p-select
          [options]="roleOptions"
          optionLabel="label"
          optionValue="value"
          [(ngModel)]="role"
        />
        <p-button
          [label]="'review.invite' | translate"
          size="small"
          [disabled]="!email"
          [loading]="busy()"
          (onClick)="invite()"
        />
      </div>

      <div class="link-row">
        <p-button
          [label]="'review.create_link' | translate"
          icon="pi pi-link"
          size="small"
          [outlined]="true"
          [loading]="busy()"
          (onClick)="createLink()"
        />
        @if (generatedLink()) {
          <input pInputText type="text" [value]="generatedLink()" readonly (focus)="selectAll($event)" />
          <p class="hint">{{ 'review.link_once' | translate }}</p>
        }
      </div>

      <ul class="share-list">
        @for (share of review.shares(); track share.id) {
          <li [class.revoked]="share.revoked">
            <span class="who">{{ share.email || share.userId || ('review.link_share' | translate) }}</span>
            <p-tag [value]="roleLabel(share.role)" severity="secondary" />
            @if (share.revoked) {
              <p-tag severity="danger" [value]="'review.revoked' | translate" />
            } @else {
              <p-button
                icon="pi pi-times"
                size="small"
                [text]="true"
                severity="danger"
                [title]="'review.revoke' | translate"
                (onClick)="review.revokeShare(share.id)"
              />
            }
          </li>
        } @empty {
          <li class="empty">{{ 'review.no_shares' | translate }}</li>
        }
      </ul>
    </p-dialog>
  `,
  styles: `
    .invite-row, .link-row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .invite-row input, .link-row input { flex: 1; min-width: 12rem; font-size: 0.8rem; }
    .hint { flex-basis: 100%; margin: 0; font-size: 0.72rem; color: var(--p-text-muted-color, #6b7280); }
    .share-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .share-list li { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; }
    .share-list li.revoked { opacity: 0.6; }
    .who { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { color: var(--p-text-muted-color, #6b7280); }
  `,
})
export class ShareDialogComponent {
  /** Needed to build the share URL; the token alone isn't enough. */
  @Input({ required: true }) documentId = '';

  readonly visible = model(false);

  protected readonly review = inject(ReviewService);
  protected email = '';
  protected role: Role = Role.COMMENTER;
  protected readonly busy = signal(false);
  protected readonly generatedLink = signal('');

  protected readonly roleOptions = [
    { value: Role.COMMENTER, label: 'Коментатор' },
    { value: Role.VIEWER, label: 'Читач' },
    { value: Role.EDITOR, label: 'Редактор' },
  ];

  roleLabel(role: Role): string {
    return this.roleOptions.find((o) => o.value === role)?.label ?? '—';
  }

  async invite(): Promise<void> {
    this.busy.set(true);
    try {
      const share = await this.review.shareByEmail(this.email.trim(), this.role);
      // Until email delivery lands, the owner passes the link on by hand.
      if (share?.linkToken) this.generatedLink.set(shareLinkUrl(this.documentId, share.linkToken));
      this.email = '';
    } finally {
      this.busy.set(false);
    }
  }

  async createLink(): Promise<void> {
    this.busy.set(true);
    try {
      const share = await this.review.createShareLink(this.role);
      if (share?.linkToken) this.generatedLink.set(shareLinkUrl(this.documentId, share.linkToken));
    } finally {
      this.busy.set(false);
    }
  }

  selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}
