import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MenuItem } from 'primeng/api';

interface NavItem extends MenuItem {
  icon: string;
  route: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar" [class.collapsed]="collapsed()">
      <nav class="nav">
        @for (item of navItems; track item.route) {
          <a
            class="nav-item"
            [routerLink]="item.route"
            routerLinkActive="active"
            [title]="item.label"
          >
            <i [class]="item.icon"></i>
            @if (!collapsed()) {
              <span class="nav-label">{{ item.label }}</span>
            }
          </a>
        }
      </nav>

      <button
        class="collapse-toggle"
        (click)="toggleCollapse()"
      >
        <i [class]="collapsed() ? 'pi pi-angle-right' : 'pi pi-angle-left'"></i>
      </button>
    </aside>
  `,
  styles: `
    .sidebar {
      display: flex;
      flex-direction: column;
      width: 16rem;
      height: 100%;
      background: var(--p-surface-card);
      border-right: 1px solid var(--p-surface-border);
      transition: width 0.2s ease;
      overflow: hidden;
    }

    .sidebar.collapsed {
      width: 4rem;
    }

    .nav {
      flex: 1;
      padding: 1rem 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      border-radius: 0.5rem;
      text-decoration: none;
      color: var(--p-text-color);
      transition: background 0.15s ease;
      white-space: nowrap;
    }

    .nav-item:hover {
      background: var(--p-surface-100);
    }

    .nav-item.active {
      background: var(--p-primary-color);
      color: var(--p-primary-contrast-color);
    }

    .nav-item i {
      font-size: 1.25rem;
      width: 1.5rem;
      text-align: center;
    }

    .nav-label {
      font-size: 0.875rem;
      font-weight: 500;
    }

    .collapse-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0.75rem;
      padding: 0.5rem;
      border: none;
      border-radius: 0.5rem;
      background: var(--p-surface-100);
      color: var(--p-text-color);
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .collapse-toggle:hover {
      background: var(--p-surface-200);
    }
  `,
})
export class SidebarComponent {
  protected readonly collapsed = signal<boolean>(false);

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'pi pi-home', route: '/dashboard' },
    { label: 'Projects', icon: 'pi pi-briefcase', route: '/projects' },
    { label: 'Templates', icon: 'pi pi-file', route: '/templates' },
    { label: 'Universities', icon: 'pi pi-building', route: '/universities' },
    { label: 'Reports', icon: 'pi pi-chart-bar', route: '/reports' },
    { label: 'Team', icon: 'pi pi-users', route: '/team' },
    { label: 'Settings', icon: 'pi pi-cog', route: '/settings' },
  ];

  toggleCollapse(): void {
    this.collapsed.update((v) => !v);
  }
}
