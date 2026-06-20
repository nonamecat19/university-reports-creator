import { Injectable, signal } from '@angular/core';
import type { Template } from '../../shared/models/template.model';
import { TemplateCategory, FieldType } from '../../shared/models/template.model';

@Injectable({ providedIn: 'root' })
export class TemplateService {
  private readonly _templates = signal<Template[]>(this.mockTemplates());
  private readonly _isLoading = signal<boolean>(false);

  readonly templates = this._templates.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  getById(id: string): Template | undefined {
    return this._templates().find((t) => t.id === id);
  }

  getByCategory(category: TemplateCategory): Template[] {
    return this._templates().filter((t) => t.category === category);
  }

  create(template: Omit<Template, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>): void {
    const newTemplate: Template = {
      ...template,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      usageCount: 0,
    };
    this._templates.update((templates) => [newTemplate, ...templates]);
  }

  update(id: string, changes: Partial<Template>): void {
    this._templates.update((templates) =>
      templates.map((t) => (t.id === id ? { ...t, ...changes, updatedAt: new Date() } : t))
    );
  }

  delete(id: string): void {
    this._templates.update((templates) => templates.filter((t) => t.id !== id));
  }

  private mockTemplates(): Template[] {
    return [
      {
        id: '1',
        name: 'Annual University Report',
        description: 'Comprehensive annual report template for universities',
        category: TemplateCategory.Annual,
        fields: [
          { id: 'f1', name: 'title', label: 'Report Title', type: FieldType.Text, required: true },
          {
            id: 'f2',
            name: 'executiveSummary',
            label: 'Executive Summary',
            type: FieldType.RichText,
            required: true,
          },
          {
            id: 'f3',
            name: 'achievements',
            label: 'Key Achievements',
            type: FieldType.Textarea,
            required: false,
          },
        ],
        isPublic: true,
        authorId: 'admin',
        authorName: 'Admin User',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-06-01'),
        usageCount: 45,
      },
      {
        id: '2',
        name: 'Research Grant Proposal',
        description: 'Template for submitting research grant proposals',
        category: TemplateCategory.Research,
        fields: [
          {
            id: 'f1',
            name: 'projectTitle',
            label: 'Project Title',
            type: FieldType.Text,
            required: true,
          },
          {
            id: 'f2',
            name: 'abstract',
            label: 'Abstract',
            type: FieldType.RichText,
            required: true,
          },
          {
            id: 'f3',
            name: 'budget',
            label: 'Budget Request',
            type: FieldType.Number,
            required: true,
          },
        ],
        isPublic: true,
        authorId: 'admin',
        authorName: 'Admin User',
        createdAt: new Date('2024-02-20'),
        updatedAt: new Date('2024-05-15'),
        usageCount: 23,
      },
      {
        id: '3',
        name: 'Accreditation Self-Study',
        description: 'Self-study report for accreditation review',
        category: TemplateCategory.Accreditation,
        fields: [
          {
            id: 'f1',
            name: 'institutionName',
            label: 'Institution Name',
            type: FieldType.Text,
            required: true,
          },
          {
            id: 'f2',
            name: 'mission',
            label: 'Mission Statement',
            type: FieldType.Textarea,
            required: true,
          },
          {
            id: 'f3',
            name: 'criteria',
            label: 'Accreditation Criteria',
            type: FieldType.MultiSelect,
            required: true,
            options: [
              { label: 'Teaching Quality', value: 'teaching' },
              { label: 'Research Output', value: 'research' },
            ],
          },
        ],
        isPublic: false,
        authorId: 'editor1',
        authorName: 'Dr. Johnson',
        createdAt: new Date('2024-03-10'),
        updatedAt: new Date('2024-04-20'),
        usageCount: 12,
      },
      {
        id: '4',
        name: 'Compliance Audit Report',
        description: 'Template for regulatory compliance audits',
        category: TemplateCategory.Compliance,
        fields: [
          {
            id: 'f1',
            name: 'auditDate',
            label: 'Audit Date',
            type: FieldType.Date,
            required: true,
          },
          {
            id: 'f2',
            name: 'auditor',
            label: 'Lead Auditor',
            type: FieldType.Text,
            required: true,
          },
          {
            id: 'f3',
            name: 'findings',
            label: 'Findings',
            type: FieldType.Textarea,
            required: true,
          },
        ],
        isPublic: true,
        authorId: 'admin',
        authorName: 'Admin User',
        createdAt: new Date('2024-04-05'),
        updatedAt: new Date('2024-06-10'),
        usageCount: 8,
      },
    ];
  }
}
