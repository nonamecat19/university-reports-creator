export interface Template {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  fields: TemplateField[];
  isPublic: boolean;
  authorId: string;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
}

export enum TemplateCategory {
  Annual = 'annual',
  Research = 'research',
  Accreditation = 'accreditation',
  Compliance = 'compliance',
  Custom = 'custom',
}

export interface TemplateField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: FieldOption[];
  validation?: FieldValidation;
}

export enum FieldType {
  Text = 'text',
  Textarea = 'textarea',
  Number = 'number',
  Date = 'date',
  Select = 'select',
  MultiSelect = 'multiselect',
  Checkbox = 'checkbox',
  File = 'file',
  RichText = 'richtext',
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
}
