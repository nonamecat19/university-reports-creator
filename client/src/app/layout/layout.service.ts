import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly sidebarVisible = signal(true);

  toggleSidebar(): void {
    this.sidebarVisible.update((v) => !v);
  }
}
