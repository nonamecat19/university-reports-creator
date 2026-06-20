import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Card } from 'primeng/card';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Badge } from 'primeng/badge';
import { TemplateService } from './template.service';
import type { Template, TemplateCategory } from '../../shared/models/template.model';
import { TemplateCategory as Category } from '../../shared/models/template.model';

@Component({
  selector: 'app-templates-list',
  imports: [FormsModule, RouterLink, Card, Button, InputText, Select, Tag, Badge],
  template: `
    <div class="page-header">
      <div class="header-content">
        <h1>Templates</h1>
        <p>Manage report templates for your university reports</p>
      </div>
      <p-button
        label="New Template"
        icon="pi pi-plus"
        severity="primary"
      />
    </div>

    <div class="filters">
      <span class="p-input-icon-left">
        <i class="pi pi-search"></i>
        <input
          pInputText
          [(ngModel)]="searchQuery"
          (ngModelChange)="filterTemplates()"
          placeholder="Search templates..."
        />
      </span>
      <p-select
        [(ngModel)]="selectedCategory"
        [options]="categoryOptions"
        placeholder="All Categories"
        (ngModelChange)="filterTemplates()"
      />
    </div>

    <div class="templates-grid">
      @for (template of filteredTemplates(); track template.id) {
        <p-card styleClass="template-card">
          <ng-template #title>{{ template.name }}</ng-template>
          <ng-template #subtitle>
            <p-tag
              [value]="getCategoryLabel(template.category)"
              [severity]="getCategorySeverity(template.category)"
            />
          </ng-template>

          <p class="description">{{ template.description }}</p>

          <div class="template-meta">
            <div class="meta-item">
              <i class="pi pi-file"></i>
              <span>{{ template.fields.length }} fields</span>
            </div>
            <div class="meta-item">
              <i class="pi pi-users"></i>
              <span>{{ template.usageCount }} uses</span>
            </div>
            @if (!template.isPublic) {
              <p-badge value="Private" severity="secondary" />
            }
          </div>

          <ng-template #footer>
            <div class="card-actions">
              <p-button
                label="View"
                severity="secondary"
                [outlined]="true"
                [routerLink]="['/templates', template.id]"
              />
              <p-button
                icon="pi pi-pencil"
                severity="secondary"
                [outlined]="true"
                [routerLink]="['/templates', template.id, 'edit']"
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
          <i class="pi pi-file"></i>
          <h3>No templates found</h3>
          <p>Try adjusting your search or filters</p>
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

    .templates-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
    }

    :host ::ng-deep .template-card {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .description {
      margin: 0 0 1rem;
      color: var(--p-text-secondary-color);
      font-size: 0.875rem;
      flex: 1;
    }

    .template-meta {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--p-surface-border);
      margin-bottom: 0.5rem;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--p-text-muted-color);
    }

    .meta-item i {
      font-size: 0.875rem;
    }

    .card-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .empty-state {
      grid-column: 1 / -1;
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
export class TemplatesListComponent {
  private readonly templateService = inject(TemplateService);

  protected searchQuery = '';
  protected selectedCategory: TemplateCategory | null = null;
  protected readonly filteredTemplates = signal<Template[]>([]);

  protected readonly categoryOptions = [
    { label: 'Annual Reports', value: Category.Annual },
    { label: 'Research', value: Category.Research },
    { label: 'Accreditation', value: Category.Accreditation },
    { label: 'Compliance', value: Category.Compliance },
    { label: 'Custom', value: Category.Custom },
  ];

  constructor() {
    this.filterTemplates();
  }

  filterTemplates(): void {
    let templates = this.templateService.templates();

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      templates = templates.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      );
    }

    if (this.selectedCategory) {
      templates = templates.filter((t) => t.category === this.selectedCategory);
    }

    this.filteredTemplates.set(templates);
  }

  getCategoryLabel(category: TemplateCategory): string {
    const labels: Record<TemplateCategory, string> = {
      [Category.Annual]: 'Annual',
      [Category.Research]: 'Research',
      [Category.Accreditation]: 'Accreditation',
      [Category.Compliance]: 'Compliance',
      [Category.Custom]: 'Custom',
    };
    return labels[category] ?? category;
  }

  getCategorySeverity(
    category: TemplateCategory
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<
      TemplateCategory,
      'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
    > = {
      [Category.Annual]: 'success',
      [Category.Research]: 'info',
      [Category.Accreditation]: 'warn',
      [Category.Compliance]: 'danger',
      [Category.Custom]: 'secondary',
    };
    return severities[category] ?? 'secondary';
  }
}
