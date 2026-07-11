import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { RadioButton } from 'primeng/radiobutton';
import { InputText } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { Toast } from 'primeng/toast';
import { LanguageService } from '../../core/services/language.service';
import { AuthService } from '../../core/services/auth.service';
import type { User } from '../../shared/models/user.model';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, Button, Card, RadioButton, InputText, Toast, TranslatePipe, RouterLink],
  providers: [MessageService],
  template: `
    <p-toast />
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
              [attr.data-testid]="'settings-lang-' + lang.code"
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

      <p-card>
        <ng-template #header>
          <div class="px-6 pt-6">
            <h2 class="text-xl font-semibold">
              {{ 'settings.profile.title' | translate }}
            </h2>
          </div>
        </ng-template>

        @if (loadingProfile()) {
          <div class="flex justify-center py-4">
            <i class="pi pi-spinner pi-spin text-2xl text-surface-400"></i>
          </div>
        } @else {
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2">
              <label for="name" class="text-sm font-medium text-surface-600">
                {{ 'settings.profile.name' | translate }}
              </label>
              <input
                pInputText
                id="name"
                [(ngModel)]="profileForm.name"
                [placeholder]="'settings.profile.name_placeholder' | translate"
                data-testid="settings-profile-name"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="university" class="text-sm font-medium text-surface-600">
                {{ 'settings.profile.university' | translate }}
              </label>
              <input
                pInputText
                id="university"
                [(ngModel)]="profileForm.university"
                [placeholder]="'settings.profile.university_placeholder' | translate"
                data-testid="settings-profile-university"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="faculty" class="text-sm font-medium text-surface-600">
                {{ 'settings.profile.faculty' | translate }}
              </label>
              <input
                pInputText
                id="faculty"
                [(ngModel)]="profileForm.faculty"
                [placeholder]="'settings.profile.faculty_placeholder' | translate"
                data-testid="settings-profile-faculty"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="department" class="text-sm font-medium text-surface-600">
                {{ 'settings.profile.department' | translate }}
              </label>
              <input
                pInputText
                id="department"
                [(ngModel)]="profileForm.department"
                [placeholder]="'settings.profile.department_placeholder' | translate"
                data-testid="settings-profile-department"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="studentGroup" class="text-sm font-medium text-surface-600">
                {{ 'settings.profile.student_group' | translate }}
              </label>
              <input
                pInputText
                id="studentGroup"
                [(ngModel)]="profileForm.studentGroup"
                [placeholder]="'settings.profile.student_group_placeholder' | translate"
                data-testid="settings-profile-student-group"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="supervisor" class="text-sm font-medium text-surface-600">
                {{ 'settings.profile.supervisor' | translate }}
              </label>
              <input
                pInputText
                id="supervisor"
                [(ngModel)]="profileForm.supervisor"
                [placeholder]="'settings.profile.supervisor_placeholder' | translate"
                data-testid="settings-profile-supervisor"
              />
            </div>
          </div>

          <div class="flex justify-end mt-4">
            <p-button
              [label]="'settings.profile.save' | translate"
              icon="pi pi-check"
              [loading]="savingProfile()"
              (onClick)="saveProfile()"
              data-testid="settings-profile-save"
            />
          </div>
        }
      </p-card>

      <div class="flex justify-end">
        <p-button
          routerLink="/"
          [label]="'common.cancel' | translate"
          severity="secondary"
          data-testid="settings-cancel"
        />
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  private langService = inject(LanguageService);
  private authService = inject(AuthService);
  private messageService = inject(MessageService);
  private translate = inject(TranslateService);

  currentLang = this.langService.current;

  languages = [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'uk', label: 'Українська', nativeLabel: 'Українська' },
  ];

  protected readonly loadingProfile = signal<boolean>(true);
  protected readonly savingProfile = signal<boolean>(false);

  protected profileForm = {
    name: '',
    university: '',
    faculty: '',
    department: '',
    studentGroup: '',
    supervisor: '',
  };

  ngOnInit(): void {
    this.loadProfile();
  }

  setLanguage(code: string) {
    this.currentLang = code;
    this.langService.setLanguage(code);
  }

  private async loadProfile(): Promise<void> {
    this.loadingProfile.set(true);
    try {
      const user = await this.authService.getProfile();
      if (user) {
        this.profileForm.name = user.name || '';
        this.profileForm.university = user.university || '';
        this.profileForm.faculty = user.faculty || '';
        this.profileForm.department = user.department || '';
        this.profileForm.studentGroup = user.studentGroup || '';
        this.profileForm.supervisor = user.supervisor || '';
      }
    } catch (error) {
      console.error('Failed to load profile', error);
    } finally {
      this.loadingProfile.set(false);
    }
  }

  protected async saveProfile(): Promise<void> {
    this.savingProfile.set(true);
    try {
      const success = await this.authService.updateProfile(this.profileForm);
      if (success) {
        this.messageService.add({
          severity: 'success',
          summary: this.translate.instant('settings.profile.updated_summary'),
          detail: this.translate.instant('settings.profile.updated_detail'),
        });
      } else {
        this.messageService.add({
          severity: 'error',
          summary: this.translate.instant('settings.profile.error_summary'),
          detail: this.translate.instant('settings.profile.error_detail'),
        });
      }
    } catch (error) {
      console.error('Failed to save profile', error);
      this.messageService.add({
        severity: 'error',
        summary: this.translate.instant('settings.profile.error_summary'),
        detail: this.translate.instant('settings.profile.error_detail'),
      });
    } finally {
      this.savingProfile.set(false);
    }
  }
}
