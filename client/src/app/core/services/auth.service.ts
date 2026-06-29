import { computed, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthServiceClient } from '@gen/auth/auth.client';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { environment } from '../../../environments/environment';
import type { LoginRequest, User } from '../../shared/models/user.model';
import { accessToken } from '../grpc/token-holder';
import { grpcTransport } from '../grpc/transport';

const STORAGE_REFRESH_TOKEN = 'refresh_token';

interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = new AuthServiceClient(grpcTransport);

  private readonly _user = signal<User | null>(null);
  private readonly _isLoading = signal<boolean>(false);
  /** In-flight silent refresh, shared so concurrent 401s trigger one refresh (FR-AUTH-10). */
  private refreshInFlight: Promise<boolean> | null = null;

  readonly user = this._user.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isAuthenticated = computed(() => !!accessToken() && !!this._user());

  /** Resolves once the initial silent-refresh-from-localStorage attempt on
   * app bootstrap has settled — route guards must await this (FR-AUTH-10). */
  readonly ready: Promise<void>;

  constructor(private readonly router: Router) {
    this.ready = this.restoreSession();
  }

  async login(credentials: LoginRequest): Promise<boolean> {
    this._isLoading.set(true);
    try {
      const call = this.client.login({
        email: credentials.email,
        password: credentials.password,
      });
      const resp = await call.response;
      await this.applySession({
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken,
        userId: '',
        email: credentials.email,
        name: '',
      });
      return true;
    } catch (error) {
      console.error('Login failed', error);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  async register(credentials: LoginRequest & { name: string }): Promise<boolean> {
    this._isLoading.set(true);
    try {
      await this.client.register(credentials).response;
      return this.login(credentials);
    } catch (error) {
      console.error('Registration failed', error);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /** Google sign-in via Google Identity Services (FR-AUTH-05): a browser
   * popup/One Tap flow yields an ID token, which the backend verifies. */
  async signInWithGoogle(): Promise<boolean> {
    if (!environment.googleClientId) {
      console.error('Google sign-in is not configured (missing googleClientId)');
      return false;
    }
    this._isLoading.set(true);
    try {
      await this.loadGisScript();
      const idToken = await this.requestGoogleIdToken();
      const resp = await this.client.loginWithGoogle({ idToken }).response;
      await this.applySession({
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken,
        userId: resp.userId,
        email: resp.email,
        name: resp.name,
      });
      return true;
    } catch (error) {
      console.error('Google sign-in failed', error);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem(STORAGE_REFRESH_TOKEN);
    if (refreshToken) {
      try {
        await this.client.logout({ refreshToken }).response;
      } catch (error) {
        console.error('Logout RPC failed (discarding local session anyway)', error);
      }
    }
    this.clearSession();
    this.router.navigate(['/auth/login']);
  }

  /** Fetches profile fields used to prefill template metadata (FR-AUTH-08). */
  async getProfile(): Promise<User | null> {
    try {
      const resp = await this.client.getProfile({}).response;
      if (!resp.profile) return null;
      const user: User = {
        id: resp.profile.userId,
        email: resp.profile.email,
        name: resp.profile.name,
        university: resp.profile.university,
        faculty: resp.profile.faculty,
        department: resp.profile.department,
        studentGroup: resp.profile.studentGroup,
        supervisor: resp.profile.supervisor,
      };
      this._user.set(user);
      return user;
    } catch (error) {
      console.error('Failed to load profile', error);
      return null;
    }
  }

  /** Calls fn, and on UNAUTHENTICATED attempts one silent refresh + retry
   * (FR-AUTH-10) before giving up and redirecting to /auth/login. */
  async callWithAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RpcError && error.code === 'UNAUTHENTICATED') {
        const refreshed = await this.silentRefresh();
        if (refreshed) {
          return await fn();
        }
        this.clearSession();
        this.router.navigate(['/auth/login']);
      }
      throw error;
    }
  }

  private async silentRefresh(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doSilentRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async doSilentRefresh(): Promise<boolean> {
    const refreshToken = localStorage.getItem(STORAGE_REFRESH_TOKEN);
    if (!refreshToken) return false;
    try {
      const resp = await this.client.refreshToken({ refreshToken }).response;
      accessToken.set(resp.accessToken);
      localStorage.setItem(STORAGE_REFRESH_TOKEN, resp.refreshToken);
      return true;
    } catch (error) {
      console.error('Silent refresh failed', error);
      return false;
    }
  }

  private async restoreSession(): Promise<void> {
    const refreshToken = localStorage.getItem(STORAGE_REFRESH_TOKEN);
    if (!refreshToken) return;
    const ok = await this.silentRefresh();
    if (ok) {
      await this.getProfile();
    }
  }

  private async applySession(session: Session): Promise<void> {
    accessToken.set(session.accessToken);
    localStorage.setItem(STORAGE_REFRESH_TOKEN, session.refreshToken);
    await this.getProfile();
  }

  private clearSession(): void {
    accessToken.set(null);
    this._user.set(null);
    localStorage.removeItem(STORAGE_REFRESH_TOKEN);
  }

  private loadGisScript(): Promise<void> {
    if (window.google?.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  private requestGoogleIdToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const identity = window.google?.accounts.id;
      if (!identity) {
        reject(new Error('Google Identity Services failed to load'));
        return;
      }
      identity.initialize({
        client_id: environment.googleClientId,
        callback: (response) => {
          if (response.credential) {
            resolve(response.credential);
          } else {
            reject(new Error('Google sign-in did not return a credential'));
          }
        },
      });
      identity.prompt();
    });
  }
}
