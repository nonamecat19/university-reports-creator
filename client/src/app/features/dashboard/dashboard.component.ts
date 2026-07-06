import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Card } from 'primeng/card';
import { Button } from 'primeng/button';
import { Avatar } from 'primeng/avatar';
import { Tag } from 'primeng/tag';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService } from '../projects/project.service';
import { TemplateService } from '../templates/template.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Card, Button, Avatar, Tag, TranslatePipe],
  template: `
    <div class="page-header">
      <div class="header-content">
        <h1>{{ 'dashboard.welcome_back' | translate: { name: userName() } }}</h1>
        <p>{{ 'dashboard.subtitle' | translate }}</p>
      </div>
      <p-button
        [label]="'dashboard.new_project' | translate"
        icon="pi pi-plus"
        severity="primary"
      />
    </div>

    <div class="stats-grid">
      <p-card styleClass="stat-card">
        <div class="stat-content">
          <div class="stat-icon blue">
            <i class="pi pi-briefcase"></i>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ projectStats().total }}</span>
            <span class="stat-label">{{ 'dashboard.active_projects' | translate }}</span>
          </div>
        </div>
      </p-card>

      <p-card styleClass="stat-card">
        <div class="stat-content">
          <div class="stat-icon green">
            <i class="pi pi-file"></i>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ projectStats().completed }}</span>
            <span class="stat-label">{{ 'dashboard.completed' | translate }}</span>
          </div>
        </div>
      </p-card>

      <p-card styleClass="stat-card">
        <div class="stat-content">
          <div class="stat-icon yellow">
            <i class="pi pi-clock"></i>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ projectStats().pending }}</span>
            <span class="stat-label">{{ 'dashboard.under_review' | translate }}</span>
          </div>
        </div>
      </p-card>

      <p-card styleClass="stat-card">
        <div class="stat-content">
          <div class="stat-icon purple">
            <i class="pi pi-file-edit"></i>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ recentTemplates() }}</span>
            <span class="stat-label">{{ 'dashboard.templates' | translate }}</span>
          </div>
        </div>
      </p-card>
    </div>

    <div class="dashboard-grid">
      <p-card styleClass="recent-card">
        <ng-template #title>{{ 'dashboard.recent_projects' | translate }}</ng-template>
        <ng-template #content>
          <div class="project-list">
            @for (project of recentProjects(); track project.id) {
              <a class="project-item" [routerLink]="['/projects', project.id]">
                <div class="project-info">
                  <p-avatar
                    [label]="project.university.name.charAt(0)"
                    shape="circle"
                  />
                  <div class="project-details">
                    <span class="project-name">{{ project.name }}</span>
                    <span class="project-university">{{ project.university.name }}</span>
                  </div>
                </div>
                <p-tag
                  [value]="'projects.status.' + project.status | translate"
                  [severity]="getStatusSeverity(project.status)"
                />
              </a>
            } @empty {
              <div class="empty-state">
                <p>{{ 'dashboard.no_recent_projects' | translate }}</p>
              </div>
            }
          </div>
        </ng-template>
        <ng-template #footer>
          <p-button routerLink="/projects" [label]="'dashboard.view_all' | translate" severity="secondary" [text]="true" />
        </ng-template>
      </p-card>

      <p-card styleClass="templates-card">
        <ng-template #title>{{ 'dashboard.popular_templates' | translate }}</ng-template>
        <ng-template #content>
          <div class="template-list">
            @for (template of popularTemplates(); track template.id) {
              <a class="template-item" [routerLink]="['/templates', template.id]">
                <div class="template-info">
                  <i class="pi pi-file"></i>
                  <div class="template-details">
                    <span class="template-name">{{ template.name }}</span>
                    <span class="template-usage">{{ 'dashboard.uses' | translate: { count: template.usageCount } }}</span>
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
          <p-button routerLink="/templates" [label]="'dashboard.view_all' | translate" severity="secondary" [text]="true" />
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
      grid-template-columns: repeat(4, 1fr);
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

    .stat-icon.yellow {
      background: var(--p-yellow-100);
      color: var(--p-yellow-600);
    }

    .stat-icon.purple {
      background: var(--p-purple-100);
      color: var(--p-purple-600);
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
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }

    .project-list,
    .template-list {
      display: flex;
      flex-direction: column;
    }

    .project-item,
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

    .project-item:hover,
    .template-item:hover {
      background: var(--p-surface-100);
    }

    .project-item:last-child,
    .template-item:last-child {
      border-bottom: none;
    }

    .project-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .project-details,
    .template-details {
      display: flex;
      flex-direction: column;
    }

    .project-name,
    .template-name {
      font-weight: 500;
    }

    .project-university,
    .template-usage {
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
  private readonly projectService = inject(ProjectService);
  private readonly templateService = inject(TemplateService);

  userName(): string {
    return this.authService.user()?.name ?? 'User';
  }

  projectStats() {
    const stats = this.projectService.stats;
    return {
      total: stats.total(),
      completed: stats.completed(),
      pending: stats.pending(),
    };
  }

  recentProjects() {
    return this.projectService.projects().slice(0, 5);
  }

  recentTemplates() {
    return this.templateService.templates().length;
  }

  popularTemplates() {
    return [...this.templateService.templates()]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);
  }

  getStatusSeverity(
    status: string
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<
      string,
      'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
    > = {
      draft: 'secondary',
      in_progress: 'info',
      under_review: 'warn',
      completed: 'success',
      archived: 'contrast',
    };
    return severities[status] ?? 'secondary';
  }
}
