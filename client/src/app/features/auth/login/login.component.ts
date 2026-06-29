import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Card, InputText, Password, Button, Message],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected name = '';
  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly isLoading = this.authService.isLoading;
  protected readonly errorMessage = signal<string>('');

  toggleMode(): void {
    this.mode.set(this.mode() === 'login' ? 'register' : 'login');
    this.errorMessage.set('');
  }

  async onSubmit(): Promise<void> {
    this.errorMessage.set('');

    if (!this.email || !this.password) {
      this.errorMessage.set('Please enter email and password');
      return;
    }
    if (this.mode() === 'register' && !this.name) {
      this.errorMessage.set('Please enter your name');
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
        this.mode() === 'register' ? 'Could not create account' : 'Invalid email or password'
      );
    }
  }

  async onGoogleSignIn(): Promise<void> {
    this.errorMessage.set('');
    const success = await this.authService.signInWithGoogle();
    if (!success) {
      this.errorMessage.set('Failed to sign in with Google');
    }
  }
}
