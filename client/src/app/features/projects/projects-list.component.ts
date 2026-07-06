import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Card } from 'primeng/card';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Badge } from 'primeng/badge';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ProjectService } from './project.service';
import type { Project, ProjectStatus } from '../../shared/models/project.model';
import { ProjectStatus as Status } from '../../shared/models/project.model';

@Component({
  selector: 'app-projects-list',
  imports: [DatePipe, FormsModule, RouterLink, Card, Button, InputText, Select, Tag, Badge, TranslatePipe],
  template: `
    <div class="page-header">
      <div class="header-content">
        <h1>{{ 'projects.title' | translate }}</h1>
        <p>{{ 'projects.subtitle' | translate }}</p>
      </div>
      <p-button
        [label]="'projects.new_project' | translate"
        icon="pi pi-plus"
        severity="primary"
      />
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <p-badge [value]="totalCount()" severity="info" />
        <span class="stat-label">{{ 'projects.total_projects' | translate }}</span>
      </div>
      <div class="stat-card">
        <p-badge [value]="activeCount()" severity="success" />
        <span class="stat-label">{{ 'projects.in_progress' | translate }}</span>
      </div>
      <div class="stat-card">
        <p-badge [value]="pendingCount()" severity="warn" />
        <span class="stat-label">{{ 'projects.under_review' | translate }}</span>
      </div>
      <div class="stat-card">
        <p-badge [value]="completedCount()" severity="secondary" />
        <span class="stat-label">{{ 'projects.completed' | translate }}</span>
      </div>
    </div>

    <div class="filters">
      <span class="p-input-icon-left">
        <i class="pi pi-search"></i>
        <input
          pInputText
          [(ngModel)]="searchQuery"
          (ngModelChange)="filterProjects()"
          [placeholder]="'projects.search_placeholder' | translate"
        />
      </span>
      <p-select
        [(ngModel)]="selectedStatus"
        [options]="statusOptions"
        [placeholder]="'projects.all_statuses' | translate"
        (ngModelChange)="filterProjects()"
      />
    </div>

    <div class="projects-list">
      @for (project of filteredProjects(); track project.id) {
        <p-card styleClass="project-card">
          <div class="project-header">
            <div class="project-info">
              <h3>{{ project.name }}</h3>
              <p class="description">{{ project.description }}</p>
              <div class="university">
                <i class="pi pi-building"></i>
                <span>{{ project.university.name }}</span>
                <span class="location">{{ project.university.location }}</span>
              </div>
            </div>
            <div class="project-status">
              <p-tag
                [value]="'projects.status.' + project.status | translate"
                [severity]="getStatusSeverity(project.status)"
              />
            </div>
          </div>

          <div class="project-meta">
            <div class="meta-item">
              <i class="pi pi-file"></i>
              <span>{{ 'projects.reports' | translate: { count: project.reports.length } }}</span>
            </div>
            <div class="meta-item">
              <i class="pi pi-calendar"></i>
              <span>{{ 'projects.due' | translate }} {{ project.dueDate | date: 'shortDate' }}</span>
            </div>
            <div class="meta-item">
              <i class="pi pi-clock"></i>
              <span>{{ 'projects.updated' | translate }} {{ getRelativeTime(project.updatedAt) | translate }}</span>
            </div>
          </div>

          <ng-template #footer>
            <div class="card-actions">
              <p-button
                [routerLink]="['/projects', project.id]"
                [label]="'projects.view' | translate"
                severity="secondary"
                [outlined]="true"
              />
              <p-button
                [routerLink]="['/projects', project.id, 'edit']"
                icon="pi pi-pencil"
                severity="secondary"
                [outlined]="true"
              />
              <p-button
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
              />
            </div>
          </ng-template>
        </p-card>
      } @empty {
        <div class="empty-state">
          <i class="pi pi-briefcase"></i>
          <h3>{{ 'projects.no_projects_found' | translate }}</h3>
          <p>{{ 'projects.try_adjusting' | translate }}</p>
        </div>
      }
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
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1.25rem 2rem;
      background: var(--p-surface-card);
      border-radius: 0.5rem;
      border: 1px solid var(--p-surface-border);
    }

    .stat-label {
      margin-top: 0.5rem;
      font-size: 0.875rem;
      color: var(--p-text-muted-color);
    }

    .filters {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .filters span {
      display: flex;
      align-items: center;
    }

    .filters input {
      width: 300px;
    }

    .projects-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    :host ::ng-deep .project-card .p-card-body {
      padding: 1.25rem;
    }

    .project-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }

    .project-info h3 {
      margin: 0 0 0.5rem;
      font-size: 1.125rem;
      font-weight: 600;
    }

    .description {
      margin: 0 0 0.75rem;
      color: var(--p-text-secondary-color);
      font-size: 0.875rem;
    }

    .university {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--p-text-color);
    }

    .location {
      color: var(--p-text-muted-color);
    }

    .project-meta {
      display: flex;
      gap: 1.5rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--p-surface-border);
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--p-text-muted-color);
    }

    .card-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }

    .empty-state i {
      font-size: 4rem;
      margin-bottom: 1rem;
    }

    .empty-state h3 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 500;
    }

    .empty-state p {
      margin: 0;
    }
  `,
})
export class ProjectsListComponent {
  private readonly projectService = inject(ProjectService);
  private readonly translate = inject(TranslateService);

  protected searchQuery = '';
  protected selectedStatus: ProjectStatus | null = null;
  protected readonly filteredProjects = signal<Project[]>([]);
  protected readonly stats = this.projectService.stats;

  protected readonly totalCount = computed(() => this.stats.total());
  protected readonly activeCount = computed(() => this.stats.active());
  protected readonly pendingCount = computed(() => this.stats.pending());
  protected readonly completedCount = computed(() => this.stats.completed());

  protected readonly statusOptions = [
    { label: this.translate.instant('projects.status.draft'), value: Status.Draft },
    { label: this.translate.instant('projects.status.in_progress'), value: Status.InProgress },
    { label: this.translate.instant('projects.status.under_review'), value: Status.UnderReview },
    { label: this.translate.instant('projects.status.completed'), value: Status.Completed },
    { label: this.translate.instant('projects.status.archived'), value: Status.Archived },
  ];

  constructor() {
    this.filterProjects();
  }

  filterProjects(): void {
    let projects = this.projectService.projects();

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      projects = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.university.name.toLowerCase().includes(query)
      );
    }

    if (this.selectedStatus) {
      projects = projects.filter((p) => p.status === this.selectedStatus);
    }

    this.filteredProjects.set(projects);
  }

  getStatusSeverity(
    status: ProjectStatus
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<
      ProjectStatus,
      'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
    > = {
      [Status.Draft]: 'secondary',
      [Status.InProgress]: 'info',
      [Status.UnderReview]: 'warn',
      [Status.Completed]: 'success',
      [Status.Archived]: 'contrast',
    };
    return severities[status] ?? 'secondary';
  }

  getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'projects.today';
    if (diffDays === 1) return 'projects.yesterday';
    if (diffDays < 7) return 'projects.days_ago';
    if (diffDays < 30) return 'projects.weeks_ago';
    return 'projects.months_ago';
  }
}
