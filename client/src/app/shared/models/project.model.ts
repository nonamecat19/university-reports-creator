export interface Project {
  id: string;
  name: string;
  description: string;
  university: University;
  status: ProjectStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  reports: Report[];
}

export enum ProjectStatus {
  Draft = 'draft',
  InProgress = 'in_progress',
  UnderReview = 'under_review',
  Completed = 'completed',
  Archived = 'archived',
}

export interface University {
  id: string;
  name: string;
  location: string;
  logo?: string;
}

export interface Report {
  id: string;
  projectId: string;
  title: string;
  content: string;
  status: ReportStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum ReportStatus {
  Draft = 'draft',
  Submitted = 'submitted',
  Approved = 'approved',
  Rejected = 'rejected',
}
