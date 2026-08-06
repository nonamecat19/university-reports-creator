import { Component, inject, type OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ReviewService } from '../../../core/services/review.service';

/**
 * Landing page for a share link, `/d/:id?token=…` (FR-REV-02). It claims the
 * link for the signed-in account and forwards to the editor; the auth guard
 * on this route means an unauthenticated reviewer signs in first and returns
 * here with the token intact (FR-REV-03).
 */
@Component({
  selector: 'app-share-accept',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="share-accept">
      @if (error()) {
        <p class="error">{{ error() }}</p>
      } @else {
        <p>{{ 'review.accepting' | translate }}</p>
      }
    </div>
  `,
  styles: `
    .share-accept { padding: 3rem; text-align: center; }
    .error { color: var(--p-red-500, #ef4444); }
  `,
})
export class ShareAcceptComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly review = inject(ReviewService);

  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const documentId = this.route.snapshot.paramMap.get('id') ?? '';
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';

    if (!token) {
      // No token: the user may already have access from an earlier accept, so
      // send them to the document and let its own access check decide.
      await this.router.navigate(['/documents', documentId]);
      return;
    }

    try {
      const result = await this.review.acceptShareLink(token);
      await this.router.navigate(['/documents', result.documentId || documentId]);
    } catch (err) {
      this.error.set(String(err));
    }
  }
}
