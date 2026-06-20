import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Card } from 'primeng/card';
import { InputText } from 'primeng/inputtext';
import { Password } from 'primeng/password';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Card, InputText, Password, Button, Message],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected email = '';
  protected password = '';
  protected readonly isLoading = this.authService.isLoading;
  protected readonly errorMessage = signal<string>('');

  async ngOnInit(): Promise<void> {
    if (window.location.hash.includes('access_token')) {
      await this.authService.handleOAuthCallback();
    }
  }

  async onSubmit(): Promise<void> {
    this.errorMessage.set('');

    if (!this.email || !this.password) {
      this.errorMessage.set('Please enter email and password');
      return;
    }

    const success = await this.authService.login({
      email: this.email,
      password: this.password,
    });

    if (success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage.set('Invalid email or password');
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
