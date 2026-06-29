import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './app/core/guards/auth.guard';
import { LoginComponent } from './app/features/auth/login/login.component';
import { DashboardComponent } from './app/features/dashboard/dashboard.component';
import { DocumentsListComponent } from './app/features/documents/documents-list.component';
import { ProjectDetailComponent } from './app/features/projects/project-detail.component';
import { ProjectsListComponent } from './app/features/projects/projects-list.component';
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
        path: 'projects',
        children: [
          {
            path: '',
            component: ProjectsListComponent,
          },
          {
            path: ':id',
            component: ProjectDetailComponent,
          },
        ],
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
        path: 'universities',
        component: DashboardComponent,
      },
      {
        path: 'reports',
        component: DashboardComponent,
      },
      {
        path: 'team',
        component: DashboardComponent,
      },
      {
        path: 'settings',
        component: DashboardComponent,
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
