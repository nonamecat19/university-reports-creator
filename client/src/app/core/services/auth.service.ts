import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, AuthSession } from '@supabase/supabase-js';
import type { User, LoginRequest } from '../../shared/models/user.model';
import { UserRole } from '../../shared/models/user.model';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase: SupabaseClient;
  private readonly _user = signal<User | null>(this.loadUser());
  private readonly _token = signal<string | null>(this.loadToken());
  private readonly _isLoading = signal<boolean>(false);

  readonly user = this._user.asReadonly();
  readonly token = this._token.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token() && !!this._user());
  readonly userRole = computed(() => this._user()?.role ?? null);

  constructor(private readonly router: Router) {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
    this.setupAuthListener();
  }

  private setupAuthListener(): void {
    this.supabase.auth.onAuthStateChange((event, session) => {
      try {
        if (event === 'SIGNED_IN' && session) {
          this.handleSession(session);
        } else if (event === 'SIGNED_OUT') {
          this.clearStorage();
          this._user.set(null);
          this._token.set(null);
        }
      } catch (error) {
        console.error('Auth state change error:', error);
      }
    });
  }

  async login(credentials: LoginRequest): Promise<boolean> {
    this._isLoading.set(true);
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });
      if (error) throw error;
      if (data.session) {
        this.handleSession(data.session);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  async signInWithGoogle(): Promise<boolean> {
    this._isLoading.set(true);
    try {
      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/auth/callback',
        },
      });
      if (error) {
        console.error('Google sign in error:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Google sign in error:', error);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  async handleOAuthCallback(): Promise<void> {
    this._isLoading.set(true);
    try {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (accessToken) {
        const response = await fetch(`${environment.supabaseUrl}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: environment.supabaseAnonKey,
          },
        });

        if (response.ok) {
          const userData = await response.json();
          const session: AuthSession = {
            access_token: accessToken,
            refresh_token: refreshToken || '',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
            user: userData as unknown as import('@supabase/supabase-js').User,
          };
          this.handleSession(session);
          window.location.hash = '';
          this.router.navigate(['/dashboard']);
          return;
        }
      }

      const {
        data: { session },
        error,
      } = await this.supabase.auth.getSession();
      if (error) throw error;
      if (session) {
        this.handleSession(session);
        window.location.hash = '';
        this.router.navigate(['/dashboard']);
      }
    } catch (error) {
      console.error('OAuth callback error:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  private handleSession(session: AuthSession): void {
    const user: User = {
      id: session.user.id,
      email: session.user.email ?? '',
      name:
        ((session.user.user_metadata as Record<string, unknown>)?.['full_name'] as string) ??
        session.user.email?.split('@')[0] ??
        'User',
      role: UserRole.Admin,
      avatar: (session.user.user_metadata as Record<string, unknown>)?.['avatar_url'] as string,
      createdAt: new Date(session.user.created_at),
    };
    this._user.set(user);
    this._token.set(session.access_token);
    this.saveToStorage(session);
  }

  logout(): void {
    this.supabase.auth.signOut();
    this._user.set(null);
    this._token.set(null);
    this.clearStorage();
    this.router.navigate(['/auth/login']);
  }

  hasRole(roles: UserRole[]): boolean {
    const currentRole = this._user()?.role;
    if (!currentRole) return false;
    return roles.includes(currentRole);
  }

  private loadUser(): User | null {
    const stored = localStorage.getItem('auth_user');
    return stored ? JSON.parse(stored) : null;
  }

  private loadToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  private saveToStorage(session: AuthSession): void {
    localStorage.setItem('auth_user', JSON.stringify(this._user()));
    localStorage.setItem('auth_token', session.access_token);
    localStorage.setItem('auth_refresh', session.refresh_token);
  }

  private clearStorage(): void {
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh');
  }
}
