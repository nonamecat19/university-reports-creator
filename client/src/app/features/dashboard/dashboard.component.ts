import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Card } from 'primeng/card';
import { Button } from 'primeng/button';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { TemplateService } from '../templates/template.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Card, Button, TranslatePipe],
  template: `
    <div class="page-header">
      <div class="header-content">
        <h1 data-testid="dashboard-welcome">{{ 'dashboard.welcome_back' | translate: { name: userName() } }}</h1>
        <p>{{ 'dashboard.subtitle' | translate }}</p>
      </div>
      <p-button
        routerLink="/documents"
        [label]="'dashboard.new_document' | translate"
        icon="pi pi-plus"
        severity="primary"
        data-testid="dashboard-new-document"
      />
    </div>

    <div class="stats-grid">
      <p-card styleClass="stat-card">
        <div class="stat-content">
          <div class="stat-icon blue">
            <i class="pi pi-file"></i>
          </div>
          <div class="stat-info">
            <span class="stat-value" data-testid="dashboard-template-count">{{ recentTemplates() }}</span>
            <span class="stat-label">{{ 'dashboard.templates' | translate }}</span>
          </div>
        </div>
      </p-card>

      <p-card styleClass="stat-card">
        <div class="stat-content">
          <div class="stat-icon green">
            <i class="pi pi-file-edit"></i>
          </div>
          <div class="stat-info">
            <span class="stat-value">0</span>
            <span class="stat-label">{{ 'dashboard.documents' | translate }}</span>
          </div>
        </div>
      </p-card>
    </div>

    <div class="dashboard-grid">
      <p-card styleClass="templates-card">
        <ng-template #title>{{ 'dashboard.recent_templates' | translate }}</ng-template>
        <ng-template #content>
          <div class="template-list" data-testid="dashboard-recent-templates">
            @for (template of recentTemplatesList(); track template.id) {
              <a class="template-item" [routerLink]="['/templates', template.id]" data-testid="dashboard-recent-template-item">
                <div class="template-info">
                  <i class="pi pi-file"></i>
                  <div class="template-details">
                    <span class="template-name">{{ template.name }}</span>
                    <span class="template-type">{{ template.reportType }}</span>
                  </div>
                </div>
                <i class="pi pi-chevron-right"></i>
              </a>
            } @empty {
              <div class="empty-state">
                <p>{{ 'dashboard.no_templates_available' | translate }}</p>
              </div>
            }
          </div>
        </ng-template>
        <ng-template #footer>
          <p-button routerLink="/templates" [label]="'dashboard.view_all' | translate" severity="secondary" [text]="true" data-testid="dashboard-view-all" />
        </ng-template>
      </p-card>
    </div>
  `,
  styles: `
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
    }

    .header-content h1 {
      margin: 0 0 0.5rem;
      font-size: 1.75rem;
      font-weight: 600;
    }

    .header-content p {
      margin: 0;
      color: var(--p-text-muted-color);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    :host ::ng-deep .stat-card .p-card-body {
      padding: 1.25rem;
    }

    .stat-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .stat-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 3rem;
      height: 3rem;
      border-radius: 0.75rem;
      font-size: 1.25rem;
    }

    .stat-icon.blue {
      background: var(--p-blue-100);
      color: var(--p-blue-600);
    }

    .stat-icon.green {
      background: var(--p-green-100);
      color: var(--p-green-600);
    }

    .stat-info {
      display: flex;
      flex-direction: column;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--p-text-muted-color);
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }

    .template-list {
      display: flex;
      flex-direction: column;
    }

    .template-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0;
      text-decoration: none;
      color: var(--p-text-color);
      border-bottom: 1px solid var(--p-surface-border);
      transition: background 0.15s ease;
      margin: 0 -1.25rem;
      padding-left: 1.25rem;
      padding-right: 1.25rem;
    }

    .template-item:hover {
      background: var(--p-surface-100);
    }

    .template-item:last-child {
      border-bottom: none;
    }

    .template-details {
      display: flex;
      flex-direction: column;
    }

    .template-name {
      font-weight: 500;
    }

    .template-type {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }

    .template-item .template-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .template-item i.pi-file {
      color: var(--p-primary-color);
    }

    .template-item i.pi-chevron-right {
      color: var(--p-text-muted-color);
    }

    .empty-state {
      padding: 2rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }

    .empty-state p {
      margin: 0;
    }
  `,
})
export class DashboardComponent {
  private readonly authService = inject(AuthService);
  private readonly templateService = inject(TemplateService);

  userName(): string {
    return this.authService.user()?.name ?? 'User';
  }

  recentTemplates() {
    return this.templateService.templates().length;
  }

  recentTemplatesList() {
    return this.templateService.templates().slice(0, 5);
  }
}
