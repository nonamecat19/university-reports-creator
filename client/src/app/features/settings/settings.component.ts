import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { RadioButton } from 'primeng/radiobutton';
import { LanguageService } from '../../core/services/language.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, Button, Card, RadioButton, TranslatePipe, RouterLink],
  template: `
    <div class="p-6 space-y-6">
      <div>
        <h1 class="text-3xl font-bold text-surface-900 dark:text-surface-0">
          {{ 'settings.title' | translate }}
        </h1>
        <p class="mt-2 text-surface-500">
          {{ 'settings.language_description' | translate }}
        </p>
      </div>

      <p-card>
        <ng-template #header>
          <div class="px-6 pt-6">
            <h2 class="text-xl font-semibold">
              {{ 'settings.language' | translate }}
            </h2>
          </div>
        </ng-template>

        <div class="space-y-4">
          @for (lang of languages; track lang.code) {
            <div
              class="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              (click)="setLanguage(lang.code)"
            >
              <p-radiobutton
                name="language"
                [value]="lang.code"
                [(ngModel)]="currentLang"
              />
              <span class="text-lg">{{ lang.label }}</span>
              @if (lang.code === currentLang) {
                <span class="text-sm text-surface-400 ml-auto">
                  {{ lang.nativeLabel }}
                </span>
              }
            </div>
          }
        </div>
      </p-card>

      <div class="flex justify-end">
        <p-button
          routerLink="/"
          [label]="'common.cancel' | translate"
          severity="secondary"
        />
      </div>
    </div>
  `,
})
export class SettingsComponent {
  private langService = inject(LanguageService);

  currentLang = this.langService.current;

  languages = [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'uk', label: 'Українська', nativeLabel: 'Українська' },
  ];

  setLanguage(code: string) {
    this.currentLang = code;
    this.langService.setLanguage(code);
  }
}
