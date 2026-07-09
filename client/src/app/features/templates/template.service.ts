import { Injectable, signal } from '@angular/core';
import type { Template } from '@gen/template/template';
import { ReportType, TemplateFilter, type Visibility } from '@gen/template/template';
import { TemplateServiceClient } from '@gen/template/template.client';
import { grpcTransport } from '../../core/grpc/transport';
import { AuthService } from '../../core/services/auth.service';

@Injectable({ providedIn: 'root' })
export class TemplateService {
  private readonly client = new TemplateServiceClient(grpcTransport);

  private readonly _templates = signal<Template[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  readonly templates = this._templates.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor(private readonly auth: AuthService) {}

  async list(filter: TemplateFilter = TemplateFilter.OWN, query = ''): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);
    try {
      const resp = await this.auth.callWithAuthRetry(
        () =>
          this.client.listTemplates({
            filter,
            reportType: ReportType.UNSPECIFIED,
            query,
            pageSize: 0,
            pageToken: '',
          }).response
      );
      this._templates.set(resp.templates);
    } catch (err) {
      console.error('Failed to load templates', err);
      this._error.set('Failed to load templates');
    } finally {
      this._isLoading.set(false);
    }
  }

  async getById(id: string): Promise<Template | undefined> {
    try {
      const resp = await this.auth.callWithAuthRetry(
        () => this.client.getTemplate({ id }).response
      );
      return resp.template;
    } catch (err) {
      console.error('Failed to load template', err);
      return undefined;
    }
  }

  async create(
    name: string,
    description: string,
    reportType: ReportType,
    fileRef = ''
  ): Promise<{ template?: Template; warnings: string[] }> {
    this._isLoading.set(true);
    this._error.set(null);
    try {
      const resp = await this.auth.callWithAuthRetry(
        () => this.client.createTemplate({ name, description, reportType, fileRef }).response
      );
      if (resp.template) {
        this._templates.update((templates) => [resp.template!, ...templates]);
      }
      return { template: resp.template, warnings: resp.warnings };
    } catch (err) {
      console.error('Failed to create template', err);
      this._error.set('Failed to create template');
      return { warnings: [] };
    } finally {
      this._isLoading.set(false);
    }
  }

  /** FR-TPL-11: marks the auto-parsed model reviewed. Passing no adjustment
   * keeps the model as service-render parsed it. */
  async confirm(id: string): Promise<Template | undefined> {
    try {
      const resp = await this.auth.callWithAuthRetry(
        () => this.client.confirmTemplate({ id, adjustedModelJson: '' }).response
      );
      return resp.template;
    } catch (err) {
      console.error('Failed to confirm template', err);
      return undefined;
    }
  }

  async update(
    id: string,
    name: string,
    description: string,
    visibility: Visibility
  ): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);
    try {
      const resp = await this.auth.callWithAuthRetry(
        () =>
          this.client.updateTemplateMeta({
            id,
            name,
            description,
            visibility,
          }).response
      );
      if (resp.template) {
        this._templates.update((templates) =>
          templates.map((t) => (t.id === id ? resp.template! : t))
        );
      }
    } catch (err) {
      console.error('Failed to update template', err);
      this._error.set('Failed to update template');
    } finally {
      this._isLoading.set(false);
    }
  }

  async remove(id: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);
    try {
      await this.auth.callWithAuthRetry(() => this.client.deleteTemplate({ id }).response);
      this._templates.update((templates) => templates.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Failed to delete template', err);
      this._error.set('Failed to delete template');
    } finally {
      this._isLoading.set(false);
    }
  }
}
