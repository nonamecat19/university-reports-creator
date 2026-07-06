import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AiTabComponent } from '../features/ai/ai-tab.component';
import { HeaderComponent } from './header/header.component';
import { SidebarComponent } from './sidebar/sidebar.component';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, AiTabComponent],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css',
})
export class LayoutComponent {
  protected readonly sidebarVisible = signal(true);
  protected readonly aiPanelVisible = signal(false);

  toggleSidebar(): void {
    this.sidebarVisible.update((v) => !v);
  }

  toggleAiPanel(): void {
    this.aiPanelVisible.update((v) => !v);
  }
}
