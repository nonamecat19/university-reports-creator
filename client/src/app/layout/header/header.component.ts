import { Component, inject } from '@angular/core';
import type { MenuItem } from 'primeng/api';
import { Avatar } from 'primeng/avatar';
import { Menu } from 'primeng/menu';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService } from '../layout.service';

@Component({
  selector: 'app-header',
  imports: [Menu, Avatar],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css',
})
export class HeaderComponent {
  private readonly authService = inject(AuthService);
  private readonly layoutService = inject(LayoutService);

  protected readonly user = this.authService.user;

  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Account',
      icon: 'pi pi-user',
      items: [
        {
          label: 'Profile',
          icon: 'pi pi-id-card',
          command: () => console.log('Profile'),
        },
        {
          label: 'Settings',
          icon: 'pi pi-cog',
          command: () => console.log('Settings'),
        },
      ],
    },
    {
      label: 'Logout',
      icon: 'pi pi-sign-out',
      command: () => this.logout(),
    },
  ];

  userInitial(): string {
    const name = this.user()?.name ?? '';
    return name.charAt(0).toUpperCase();
  }

  logout(): void {
    void this.authService.logout();
  }

  toggleSidebar(): void {
    this.layoutService.toggleSidebar();
  }
}
