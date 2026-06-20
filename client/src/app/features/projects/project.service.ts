import { Injectable, signal } from '@angular/core';
import type { Project, ProjectStatus, Report } from '../../shared/models/project.model';
import { ProjectStatus as Status, ReportStatus } from '../../shared/models/project.model';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly _projects = signal<Project[]>(this.mockProjects());
  private readonly _isLoading = signal<boolean>(false);
  private readonly _selectedProject = signal<Project | null>(null);

  readonly projects = this._projects.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly selectedProject = this._selectedProject.asReadonly();

  readonly stats = {
    total: () => this._projects().length,
    active: () => this._projects().filter((p) => p.status === Status.InProgress).length,
    completed: () => this._projects().filter((p) => p.status === Status.Completed).length,
    pending: () => this._projects().filter((p) => p.status === Status.UnderReview).length,
  };

  getById(id: string): Project | undefined {
    return this._projects().find((p) => p.id === id);
  }

  select(id: string): void {
    const project = this.getById(id);
    this._selectedProject.set(project ?? null);
  }

  create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'reports'>): void {
    const newProject: Project = {
      ...project,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      reports: [],
    };
    this._projects.update((projects) => [newProject, ...projects]);
  }

  update(id: string, changes: Partial<Project>): void {
    this._projects.update((projects) =>
      projects.map((p) => (p.id === id ? { ...p, ...changes, updatedAt: new Date() } : p))
    );
  }

  updateStatus(id: string, status: ProjectStatus): void {
    this.update(id, { status });
  }

  delete(id: string): void {
    this._projects.update((projects) => projects.filter((p) => p.id !== id));
  }

  addReport(
    projectId: string,
    report: Omit<Report, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
  ): void {
    const newReport: Report = {
      ...report,
      id: crypto.randomUUID(),
      projectId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this._projects.update((projects) =>
      projects.map((p) =>
        p.id === projectId ? { ...p, reports: [...p.reports, newReport], updatedAt: new Date() } : p
      )
    );
  }

  private mockProjects(): Project[] {
    return [
      {
        id: '1',
        name: 'MIT Annual Report 2024',
        description: 'Comprehensive annual report for Massachusetts Institute of Technology',
        university: { id: '1', name: 'MIT', location: 'Cambridge, MA' },
        status: Status.InProgress,
        createdBy: 'admin',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-06-01'),
        dueDate: new Date('2024-12-31'),
        reports: [
          {
            id: 'r1',
            projectId: '1',
            title: 'Executive Summary',
            content: 'Executive summary draft...',
            status: ReportStatus.Draft,
            version: 1,
            createdAt: new Date('2024-01-20'),
            updatedAt: new Date('2024-01-20'),
          },
        ],
      },
      {
        id: '2',
        name: 'Stanford Research Grant',
        description: 'NSF research grant proposal for AI research',
        university: { id: '2', name: 'Stanford', location: 'Stanford, CA' },
        status: Status.UnderReview,
        createdBy: 'editor1',
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-05-15'),
        dueDate: new Date('2024-07-01'),
        reports: [],
      },
      {
        id: '3',
        name: 'Harvard Accreditation Report',
        description: 'NEASC accreditation self-study report',
        university: { id: '3', name: 'Harvard', location: 'Cambridge, MA' },
        status: Status.Completed,
        createdBy: 'admin',
        createdAt: new Date('2023-09-01'),
        updatedAt: new Date('2024-03-15'),
        reports: [],
      },
      {
        id: '4',
        name: 'Berkeley Compliance Audit',
        description: 'Annual regulatory compliance audit report',
        university: { id: '4', name: 'UC Berkeley', location: 'Berkeley, CA' },
        status: Status.Draft,
        createdBy: 'editor2',
        createdAt: new Date('2024-05-01'),
        updatedAt: new Date('2024-05-01'),
        dueDate: new Date('2024-08-31'),
        reports: [],
      },
    ];
  }
}
