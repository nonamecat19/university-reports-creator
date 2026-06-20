import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Card } from 'primeng/card';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Divider } from 'primeng/divider';
import { Timeline } from 'primeng/timeline';
import { ProjectService } from './project.service';
import type { Project, ProjectStatus, Report } from '../../shared/models/project.model';
import { ProjectStatus as Status } from '../../shared/models/project.model';

@Component({
  selector: 'app-project-detail',
  imports: [DatePipe, RouterLink, Card, Button, Tag, Divider, Timeline],
  template: `
    <div class="page-header">
      <div class="header-content">
        <p-button routerLink="/projects" variant="text" icon="pi pi-arrow-left" />
        <div class="header-text">
          <h1>{{ project()?.name }}</h1>
          <p>{{ project()?.university?.name }}</p>
        </div>
      </div>
      <div class="header-actions">
        <p-button
          [routerLink]="['/projects', project()?.id, 'edit']"
          label="Edit Project"
          icon="pi pi-pencil"
          severity="secondary"
          [outlined]="true"
        />
        <p-button
          label="New Report"
          icon="pi pi-plus"
          severity="primary"
          (onClick)="addReport()"
        />
      </div>
    </div>

    @if (project(); as p) {
      <div class="content-grid">
        <div class="main-content">
          <p-card styleClass="info-card">
            <ng-template #title>Project Overview</ng-template>

            <p class="description">{{ p.description }}</p>

            <p-divider />

            <div class="status-section">
              <h4>Current Status</h4>
              <p-tag
                [value]="getStatusLabel(p.status)"
                [severity]="getStatusSeverity(p.status)"
                [styleClass]="'mb-3'"
              />
            </div>

            <div class="dates-section">
              <h4>Timeline</h4>
              <div class="date-item">
                <span class="date-label">Created</span>
                <span class="date-value">{{ p.createdAt | date: 'mediumDate' }}</span>
              </div>
              <div class="date-item">
                <span class="date-label">Last Updated</span>
                <span class="date-value">{{ p.updatedAt | date: 'mediumDate' }}</span>
              </div>
              @if (p.dueDate) {
                <div class="date-item">
                  <span class="date-label">Due Date</span>
                  <span class="date-value" [class.overdue]="isOverdue(p.dueDate)">
                    {{ p.dueDate | date: 'mediumDate' }}
                    @if (isOverdue(p.dueDate)) {
                      <p-tag value="Overdue" severity="danger" />
                    }
                  </span>
                </div>
              }
            </div>
          </p-card>

          <p-card styleClass="reports-card">
            <ng-template #title>Reports ({{ p.reports.length }})</ng-template>

            <div class="reports-list">
              @for (report of p.reports; track report.id) {
                <div class="report-item">
                  <div class="report-info">
                    <h5>{{ report.title }}</h5>
                    <div class="report-meta">
                      <span>Version {{ report.version }}</span>
                      <span>Updated {{ report.updatedAt | date: 'short' }}</span>
                    </div>
                  </div>
                  <p-tag
                    [value]="report.status"
                    [severity]="getReportSeverity(report.status)"
                  />
                </div>
              } @empty {
                <div class="empty-reports">
                  <i class="pi pi-file"></i>
                  <p>No reports yet</p>
                  <p-button
                    label="Create First Report"
                    icon="pi pi-plus"
                    [outlined]="true"
                    severity="secondary"
                    (onClick)="addReport()"
                  />
                </div>
              }
            </div>
          </p-card>
        </div>

        <div class="sidebar-content">
          <p-card styleClass="activity-card">
            <ng-template #title>Activity</ng-template>

            <p-timeline [value]="activityEvents" />
          </p-card>

          <p-card styleClass="team-card">
            <ng-template #title>Team</ng-template>

            <div class="team-list">
              <div class="team-member">
                <div class="avatar">SC</div>
                <div class="member-info">
                  <span class="name">Dr. Sarah Chen</span>
                  <span class="role">Project Lead</span>
                </div>
              </div>
              <div class="team-member">
                <div class="avatar">MJ</div>
                <div class="member-info">
                  <span class="name">Prof. Michael Johnson</span>
                  <span class="role">Contributor</span>
                </div>
              </div>
            </div>

            <ng-template #footer>
              <p-button
                label="Invite Member"
                icon="pi pi-user-plus"
                [text]="true"
                severity="secondary"
              />
            </ng-template>
          </p-card>
        </div>
      </div>
    } @else {
      <div class="not-found">
        <i class="pi pi-file-not-found"></i>
        <h2>Project not found</h2>
        <p-button routerLink="/projects" label="Back to Projects" />
      </div>
    }
  `,
  styles: `
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
    }

    .header-content {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }

    .header-text h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      font-weight: 600;
    }

    .header-text p {
      margin: 0;
      color: var(--p-text-muted-color);
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    .content-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.5rem;
    }

    .description {
      margin: 0 0 1rem;
      color: var(--p-text-secondary-color);
    }

    .status-section h4,
    .dates-section h4 {
      margin: 0 0 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--p-text-muted-color);
      text-transform: uppercase;
    }

    .date-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
    }

    .date-label {
      color: var(--p-text-secondary-color);
    }

    .date-value {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 500;
    }

    .date-value.overdue {
      color: var(--p-red-500);
    }

    .reports-list {
      display: flex;
      flex-direction: column;
    }

    .report-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 0;
      border-bottom: 1px solid var(--p-surface-border);
    }

    .report-item:last-child {
      border-bottom: none;
    }

    .report-info h5 {
      margin: 0 0 0.25rem;
      font-size: 1rem;
      font-weight: 500;
    }

    .report-meta {
      display: flex;
      gap: 1rem;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }

    .empty-reports {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem;
      text-align: center;
    }

    .empty-reports i {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      color: var(--p-text-muted-color);
    }

    .empty-reports p {
      margin: 0 0 1rem;
      color: var(--p-text-muted-color);
    }

    .team-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .team-member {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      background: var(--p-primary-color);
      color: var(--p-primary-contrast-color);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .member-info {
      display: flex;
      flex-direction: column;
    }

    .member-info .name {
      font-size: 0.875rem;
      font-weight: 500;
    }

    .member-info .role {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }

    .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      text-align: center;
    }

    .not-found i {
      font-size: 4rem;
      margin-bottom: 1rem;
      color: var(--p-text-muted-color);
    }

    .not-found h2 {
      margin: 0 0 1rem;
    }
  `,
})
export class ProjectDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);

  protected readonly project = signal<Project | undefined | null>(undefined);

  protected readonly activityEvents = [
    {
      status: 'Created',
      date: 'Jan 15, 2024',
      icon: 'pi pi-plus',
      color: 'var(--p-primary-color)',
    },
    {
      status: 'Status Changed',
      date: 'Feb 1, 2024',
      icon: 'pi pi-refresh',
      color: 'var(--p-info-color)',
    },
    {
      status: 'Report Added',
      date: 'Mar 10, 2024',
      icon: 'pi pi-file',
      color: 'var(--p-success-color)',
    },
  ];

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.project.set(this.projectService.getById(id));
    }
  }

  addReport(): void {
    console.log('Creating new report for project:', this.project()?.id);
  }

  getStatusLabel(status: ProjectStatus): string {
    const labels: Record<ProjectStatus, string> = {
      [Status.Draft]: 'Draft',
      [Status.InProgress]: 'In Progress',
      [Status.UnderReview]: 'Under Review',
      [Status.Completed]: 'Completed',
      [Status.Archived]: 'Archived',
    };
    return labels[status] ?? status;
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

  getReportSeverity(
    status: string
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<
      string,
      'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
    > = {
      draft: 'secondary',
      submitted: 'info',
      approved: 'success',
      rejected: 'danger',
    };
    return severities[status] ?? 'secondary';
  }

  isOverdue(dueDate: Date): boolean {
    return new Date() > dueDate;
  }
}
