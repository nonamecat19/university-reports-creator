import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Card } from 'primeng/card';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Divider } from 'primeng/divider';
import { Tag as TagComponent } from 'primeng/tag';
import { TranslatePipe } from '@ngx-translate/core';
import { TemplateService } from './template.service';
import type { Template } from '../../shared/models/template.model';
import { FieldType } from '../../shared/models/template.model';

@Component({
  selector: 'app-template-detail',
  imports: [DatePipe, RouterLink, Card, Button, TagComponent, Divider, TranslatePipe],
  template: `
    <div class="page-header">
      <div class="header-content">
        <p-button routerLink="/templates" variant="text" icon="pi pi-arrow-left" />
        <div class="header-text">
          <h1>{{ template()?.name }}</h1>
          <p>{{ template()?.description }}</p>
        </div>
      </div>
      <div class="header-actions">
        <p-button
          [routerLink]="['/templates', template()?.id, 'edit']"
          [label]="'template_detail.edit_template' | translate"
          icon="pi pi-pencil"
          severity="secondary"
          [outlined]="true"
        />
        <p-button
          [label]="'template_detail.use_template' | translate"
          icon="pi pi-plus"
          severity="primary"
          (onClick)="useTemplate()"
        />
      </div>
    </div>

    @if (template(); as t) {
      <div class="content-grid">
        <p-card styleClass="info-card">
          <ng-template #title>{{ 'template_detail.template_info' | translate }}</ng-template>

          <div class="info-grid">
            <div class="info-item">
              <span class="label">{{ 'template_detail.category' | translate }}</span>
              <p-tag
                [value]="'templates.category.' + t.category | translate"
                [severity]="getCategorySeverity(t.category)"
              />
            </div>
            <div class="info-item">
              <span class="label">{{ 'template_detail.visibility' | translate }}</span>
              <p-tag [value]="(t.isPublic ? 'template_detail.public' : 'template_detail.private') | translate" />
            </div>
            <div class="info-item">
              <span class="label">{{ 'template_detail.author' | translate }}</span>
              <span class="value">{{ t.authorName }}</span>
            </div>
            <div class="info-item">
              <span class="label">{{ 'template_detail.usage_count' | translate }}</span>
              <span class="value">{{ 'template_detail.times' | translate: { count: t.usageCount } }}</span>
            </div>
            <div class="info-item">
              <span class="label">{{ 'template_detail.created' | translate }}</span>
              <span class="value">{{ t.createdAt | date: 'mediumDate' }}</span>
            </div>
            <div class="info-item">
              <span class="label">{{ 'template_detail.last_updated' | translate }}</span>
              <span class="value">{{ t.updatedAt | date: 'mediumDate' }}</span>
            </div>
          </div>
        </p-card>

        <p-card styleClass="fields-card">
          <ng-template #title>{{ 'template_detail.form_fields' | translate: { count: t.fields.length } }}</ng-template>

          <div class="fields-list">
            @for (field of t.fields; track field.id; let i = $index) {
              <div class="field-item">
                <span class="field-number">{{ i + 1 }}</span>
                <div class="field-info">
                  <span class="field-name">{{ field.label }}</span>
                  <span class="field-type">{{ 'template_detail.field_type.' + field.type | translate }}</span>
                </div>
                @if (field.required) {
                  <p-tag [value]="'template_detail.required' | translate" severity="danger" />
                }
                @if (field.options?.length) {
                  <p-tag [value]="'template_detail.options' | translate: { count: field.options?.length ?? 0 }" severity="info" />
                }
              </div>
              @if (i < t.fields.length - 1) {
                <p-divider />
              }
            }
          </div>
        </p-card>
      </div>
    } @else {
      <div class="not-found">
        <i class="pi pi-file-not-found"></i>
        <h2>{{ 'template_detail.template_not_found' | translate }}</h2>
        <p-button routerLink="/templates" [label]="'template_detail.back_to_templates' | translate" />
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
      margin: 0 0 0.5rem;
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
      grid-template-columns: 1fr 2fr;
      gap: 1.5rem;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-item .label {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-item .value {
      font-size: 0.875rem;
      font-weight: 500;
    }

    .fields-list {
      display: flex;
      flex-direction: column;
    }

    .field-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
    }

    .field-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: var(--p-surface-100);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .field-info {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .field-name {
      font-weight: 500;
    }

    .field-type {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
      text-transform: capitalize;
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
export class TemplateDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly templateService = inject(TemplateService);

  protected readonly template = signal<Template | undefined | null>(undefined);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.template.set(this.templateService.getById(id));
    }
  }

  useTemplate(): void {
    console.log('Creating new report from template:', this.template()?.id);
  }

  getCategorySeverity(
    category: string
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<
      string,
      'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
    > = {
      annual: 'success',
      research: 'info',
      accreditation: 'warn',
      compliance: 'danger',
      custom: 'secondary',
    };
    return severities[category] ?? 'secondary';
  }
}
