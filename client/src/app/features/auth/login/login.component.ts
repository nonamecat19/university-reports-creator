import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Card, InputText, Password, Button, Message, TranslatePipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly langService = inject(LanguageService);

  protected email = '';
  protected password = '';
  protected name = '';
  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly isLoading = this.authService.isLoading;
  protected readonly errorMessage = signal<string>('');
  protected readonly currentLang = signal(this.langService.current);

  toggleMode(): void {
    this.mode.set(this.mode() === 'login' ? 'register' : 'login');
    this.errorMessage.set('');
  }

  setLanguage(code: string): void {
    this.langService.setLanguage(code);
    this.currentLang.set(code);
  }

  async onSubmit(): Promise<void> {
    this.errorMessage.set('');

    if (!this.email || !this.password) {
      this.errorMessage.set('login.enter_email_password');
      return;
    }
    if (this.mode() === 'register' && !this.name) {
      this.errorMessage.set('login.enter_name');
      return;
    }

    const success =
      this.mode() === 'register'
        ? await this.authService.register({
            email: this.email,
            password: this.password,
            name: this.name,
          })
        : await this.authService.login({ email: this.email, password: this.password });

    if (success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage.set(
        this.mode() === 'register' ? 'login.could_not_create_account' : 'login.invalid_credentials'
      );
    }
  }

  async onGoogleSignIn(): Promise<void> {
    this.errorMessage.set('');
    const success = await this.authService.signInWithGoogle();
    if (!success) {
      this.errorMessage.set('login.google_signin_failed');
    }
  }
}
