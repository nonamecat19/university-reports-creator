import type { Locator } from '@playwright/test';

/**
 * PrimeNG components (p-button, p-password, p-select, ...) render the real
 * interactive control inside a custom host element. `data-testid` set on the
 * component tag lands on that host, not the inner control — clicking/filling
 * the host directly is unreliable (form submission in particular silently
 * no-ops). Always target the descendant control explicitly via these helpers.
 */
export function pButton(host: Locator): Locator {
  return host.locator('button');
}

export function pInput(host: Locator): Locator {
  return host.locator('input');
}
