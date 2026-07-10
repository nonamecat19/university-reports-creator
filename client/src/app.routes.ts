import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './app/core/guards/auth.guard';
import { LoginComponent } from './app/features/auth/login/login.component';
import { DashboardComponent } from './app/features/dashboard/dashboard.component';
import { DocumentsListComponent } from './app/features/documents/documents-list.component';
import { DocumentEditorComponent } from './app/features/documents/editor/document-editor.component';
import { SettingsComponent } from './app/features/settings/settings.component';
import { TemplateDetailComponent } from './app/features/templates/template-detail.component';
import { TemplatesListComponent } from './app/features/templates/templates-list.component';
import { LayoutComponent } from './app/layout/layout.component';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        component: LoginComponent,
      },
      {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        component: DashboardComponent,
      },
      {
        path: 'documents',
        component: DocumentsListComponent,
      },
      {
        path: 'documents/:id',
        component: DocumentEditorComponent,
      },
      {
        path: 'templates',
        children: [
          {
            path: '',
            component: TemplatesListComponent,
          },
          {
            path: ':id',
            component: TemplateDetailComponent,
          },
        ],
      },
      {
        path: 'settings',
        component: SettingsComponent,
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
