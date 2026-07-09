/**
 * Template model aligned with proto/template/template.proto
 * ReportType and Visibility enums match the proto definitions.
 */

export enum ReportType {
  UNSPECIFIED = 0,
  COURSE = 1,
  DIPLOMA = 2,
  PRACTICE = 3,
  OTHER = 4,
}

export enum Visibility {
  UNSPECIFIED = 0,
  PRIVATE = 1,
  PUBLIC = 2,
}

export enum TemplateFilter {
  UNSPECIFIED = 0,
  OWN = 1,
  PUBLIC = 2,
}

export interface Template {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  reportType: ReportType;
  visibility: Visibility;
  currentVersion: number;
  modelJson: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Helper to convert proto Timestamp to JS Date */
export function timestampToDate(ts?: { seconds: bigint; nanos: number }): Date | undefined {
  if (!ts) return undefined;
  return new Date(Number(ts.seconds) * 1000 + ts.nanos / 1_000_000);
}

/** Helper to get display label for ReportType */
export function getReportTypeLabel(type: ReportType): string {
  const labels: Record<ReportType, string> = {
    [ReportType.UNSPECIFIED]: 'templates.report_type.unspecified',
    [ReportType.COURSE]: 'templates.report_type.course',
    [ReportType.DIPLOMA]: 'templates.report_type.diploma',
    [ReportType.PRACTICE]: 'templates.report_type.practice',
    [ReportType.OTHER]: 'templates.report_type.other',
  };
  return labels[type] ?? labels[ReportType.UNSPECIFIED];
}

/** Helper to get severity for ReportType (for PrimeNG tags) */
export function getReportTypeSeverity(type: ReportType): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
  const severities: Record<ReportType, 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'> = {
    [ReportType.UNSPECIFIED]: 'secondary',
    [ReportType.COURSE]: 'info',
    [ReportType.DIPLOMA]: 'success',
    [ReportType.PRACTICE]: 'warn',
    [ReportType.OTHER]: 'secondary',
  };
  return severities[type] ?? 'secondary';
}

/** Helper to get display label for Visibility */
export function getVisibilityLabel(visibility: Visibility): string {
  const labels: Record<Visibility, string> = {
    [Visibility.UNSPECIFIED]: 'templates.visibility.unspecified',
    [Visibility.PRIVATE]: 'templates.visibility.private',
    [Visibility.PUBLIC]: 'templates.visibility.public',
  };
  return labels[visibility] ?? labels[Visibility.UNSPECIFIED];
}
