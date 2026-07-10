import {
  GetProfileRequest,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  ProfileResponse,
  RegisterRequest,
  RegisterResponse,
} from '@gen/auth/auth';
import { newLoginResponse, newProfileResponse } from '../support/factory';
import { GrpcStatus, mockUnary } from '../support/grpc-mock';
import { pButton, pInput } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

test('logs in with valid credentials and lands on the dashboard', async ({ page }) => {
  await mockUnary<LoginRequest, LoginResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'Login',
    requestType: LoginRequest,
    responseType: LoginResponse,
    handler: (input) =>
      input.email === 'test@example.com' && input.password === 'correct-password'
        ? newLoginResponse()
        : { error: { status: GrpcStatus.UNAUTHENTICATED, message: 'invalid credentials' } },
  });
  await mockUnary<GetProfileRequest, ProfileResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'GetProfile',
    requestType: GetProfileRequest,
    responseType: ProfileResponse,
    handler: () => newProfileResponse(),
  });

  await page.goto('/auth/login');
  await page.getByTestId('login-email-input').fill('test@example.com');
  await pInput(page.getByTestId('login-password-input')).fill('correct-password');
  await pButton(page.getByTestId('login-submit')).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('dashboard-welcome')).toContainText('Test User');
});

test('shows a translated error message on invalid credentials', async ({ page }) => {
  await mockUnary<LoginRequest, LoginResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'Login',
    requestType: LoginRequest,
    responseType: LoginResponse,
    handler: () => ({ error: { status: GrpcStatus.UNAUTHENTICATED, message: 'invalid credentials' } }),
  });

  await page.goto('/auth/login');
  await page.getByTestId('login-email-input').fill('wrong@example.com');
  await pInput(page.getByTestId('login-password-input')).fill('wrong-password');
  await pButton(page.getByTestId('login-submit')).click();

  // Regression guard: login.component.html used to bind the raw i18n key
  // (e.g. "login.invalid_credentials") instead of piping it through `translate`.
  await expect(page.getByTestId('login-error')).toContainText('Invalid email or password');
  await expect(page.getByTestId('login-error')).not.toContainText('login.invalid_credentials');
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test('registers a new account, then logs in and lands on the dashboard', async ({ page }) => {
  await mockUnary<RegisterRequest, RegisterResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'Register',
    requestType: RegisterRequest,
    responseType: RegisterResponse,
    handler: () => RegisterResponse.create({ userId: 'user-2' }),
  });
  await mockUnary<LoginRequest, LoginResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'Login',
    requestType: LoginRequest,
    responseType: LoginResponse,
    handler: () => newLoginResponse(),
  });
  await mockUnary<GetProfileRequest, ProfileResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'GetProfile',
    requestType: GetProfileRequest,
    responseType: ProfileResponse,
    handler: () => newProfileResponse({ name: 'New User' }),
  });

  await page.goto('/auth/login');
  await page.getByTestId('login-toggle-mode').click();
  await page.getByTestId('login-name-input').fill('New User');
  await page.getByTestId('login-email-input').fill('new@example.com');
  await pInput(page.getByTestId('login-password-input')).fill('a-new-password');
  await pButton(page.getByTestId('login-submit')).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('dashboard-welcome')).toContainText('New User');
});

test('logs out and returns to the login page', async ({ authedPage: page }) => {
  await mockUnary<LogoutRequest, LogoutResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'Logout',
    requestType: LogoutRequest,
    responseType: LogoutResponse,
    handler: () => LogoutResponse.create({}),
  });

  await page.getByTestId('header-user-menu').click();
  await page.getByTestId('header-logout-btn').click();

  await expect(page).toHaveURL(/\/auth\/login$/);
});

test('guestGuard redirects an authenticated user away from /auth/login', async ({ authedPage: page }) => {
  await page.goto('/auth/login');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('authGuard redirects an unauthenticated user to /auth/login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/auth\/login$/);
});
