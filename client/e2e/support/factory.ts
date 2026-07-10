import { LoginResponse, Profile, ProfileResponse } from '@gen/auth/auth';
import { Document } from '@gen/document/document';
import { ReportType, Template, Visibility } from '@gen/template/template';

export function newLoginResponse(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return LoginResponse.create({
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    ...overrides,
  });
}

export function newProfileResponse(overrides: Partial<Profile> = {}): ProfileResponse {
  return ProfileResponse.create({
    profile: Profile.create({
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      university: '',
      faculty: '',
      department: '',
      studentGroup: '',
      supervisor: '',
      ...overrides,
    }),
  });
}

export function newDocument(overrides: Partial<Document> = {}): Document {
  return Document.create({
    id: 'doc-1',
    ownerId: 'user-1',
    templateId: '',
    templateVersion: 0,
    title: 'My Report',
    metadata: {},
    metadataRevision: 0,
    ...overrides,
  });
}

export function newTemplate(overrides: Partial<Template> = {}): Template {
  return Template.create({
    id: 'template-1',
    ownerId: 'user-1',
    name: 'Diploma Template',
    description: 'A template for diploma reports',
    reportType: ReportType.DIPLOMA,
    visibility: Visibility.PRIVATE,
    currentVersion: 1,
    modelJson: '',
    ...overrides,
  });
}
