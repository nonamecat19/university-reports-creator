import { ProfileResponse, UpdateProfileRequest } from '@gen/auth/auth';
import { newProfileResponse } from '../support/factory';
import { mockUnary } from '../support/grpc-mock';
import { pButton } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

test('switches the interface language', async ({ authedPage: page }) => {
  await page.getByTestId('sidebar-settings').click();
  await expect(page.getByTestId('settings-lang-en')).toBeVisible();

  await page.getByTestId('settings-lang-uk').click();
  await expect(page.locator('h1')).toContainText('Налаштування');

  await page.getByTestId('settings-lang-en').click();
  await expect(page.locator('h1')).toContainText('Settings');
});

test('loads and saves the profile form', async ({ authedPage: page }) => {
  await page.getByTestId('sidebar-settings').click();
  await expect(page.getByTestId('settings-profile-name')).toHaveValue('Test User');

  await mockUnary<UpdateProfileRequest, ProfileResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'UpdateProfile',
    requestType: UpdateProfileRequest,
    responseType: ProfileResponse,
    handler: (input) => newProfileResponse({ name: input.name, university: input.university }),
  });

  await page.getByTestId('settings-profile-university').fill('National Tech University');
  await pButton(page.getByTestId('settings-profile-save')).click();

  await expect(page.getByText('Profile Updated')).toBeVisible();
});

test('shows an error toast when the profile save fails', async ({ authedPage: page }) => {
  await page.getByTestId('sidebar-settings').click();
  await expect(page.getByTestId('settings-profile-name')).toHaveValue('Test User');

  await mockUnary<UpdateProfileRequest, ProfileResponse>(page, GATEWAY_URL, {
    service: 'auth.AuthService',
    method: 'UpdateProfile',
    requestType: UpdateProfileRequest,
    responseType: ProfileResponse,
    handler: () => ({ error: { status: 13, message: 'internal error' } }),
  });

  await pButton(page.getByTestId('settings-profile-save')).click();

  await expect(page.getByText('Failed to save profile')).toBeVisible();
});

test('cancel navigates back to the dashboard', async ({ authedPage: page }) => {
  await page.getByTestId('sidebar-settings').click();
  await pButton(page.getByTestId('settings-cancel')).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
