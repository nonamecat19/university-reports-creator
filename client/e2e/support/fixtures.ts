import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  GetProfileRequest,
  LoginRequest,
  LoginResponse,
  ProfileResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from '@gen/auth/auth';
import { mockUnary } from './grpc-mock';
import { newLoginResponse, newProfileResponse } from './factory';
import { pButton, pInput } from './prime';

export const GATEWAY_URL = 'http://localhost:8080';

interface Fixtures {
  /** A page that has already completed the login flow and landed on /dashboard. */
  authedPage: Page;
}

export const test = base.extend<Fixtures>({
  authedPage: async ({ page }, use) => {
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
      handler: () => newProfileResponse(),
    });
    // The access token lives in memory only; any full-page navigation (goto,
    // reload) forces a silent-refresh round trip via the refresh token stored
    // in localStorage. Mocked here so downstream full navigations in tests
    // that use this fixture don't hit the real backend.
    await mockUnary<RefreshTokenRequest, RefreshTokenResponse>(page, GATEWAY_URL, {
      service: 'auth.AuthService',
      method: 'RefreshToken',
      requestType: RefreshTokenRequest,
      responseType: RefreshTokenResponse,
      handler: () =>
        RefreshTokenResponse.create({ accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token' }),
    });

    await page.goto('/auth/login');
    await page.getByTestId('login-email-input').fill('test@example.com');
    await pInput(page.getByTestId('login-password-input')).fill('correct-password');
    await pButton(page.getByTestId('login-submit')).click();
    await page.waitForURL(/\/dashboard$/);

    await use(page);
  },
});

export { expect } from '@playwright/test';
