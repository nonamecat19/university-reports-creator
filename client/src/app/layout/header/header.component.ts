import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Avatar } from 'primeng/avatar';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService } from '../layout.service';

@Component({
  selector: 'app-header',
  imports: [Avatar, TranslatePipe],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css',
})
export class HeaderComponent {
  private readonly authService = inject(AuthService);
  private readonly layoutService = inject(LayoutService);
  private readonly router = inject(Router);

  protected readonly user = this.authService.user;
  protected readonly menuOpen = signal(false);

  userInitial(): string {
    const name = this.user()?.name ?? '';
    return name.charAt(0).toUpperCase();
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  navigateToSettings(): void {
    this.closeMenu();
    this.router.navigate(['/settings']);
  }

  logout(): void {
    this.closeMenu();
    void this.authService.logout();
  }

  toggleSidebar(): void {
    this.layoutService.toggleSidebar();
  }
}
