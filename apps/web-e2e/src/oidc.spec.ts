import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test as base } from './support/fixtures';
import { OIDC_EMAIL, type OidcProvider, startOidcProvider, TEST_CERTIFICATE_FILE } from './support/oidc-provider';

// Each test has its own instance, so no test logs in more than the `oidc` rate-limit group allows (LG-65).
const test = base.extend<{ provider: OidcProvider; }>({
  provider: async ({}, use) => {
    const provider = await startOidcProvider();
    try {
      await use(provider);
    } finally {
      await provider.stop();
    }
  },
  instanceOptions: async ({ provider }, use) => {
    await use({ oidc: { issuer: provider.issuer, adminEmail: OIDC_EMAIL }, extraCaFile: TEST_CERTIFICATE_FILE });
  }
});

// The provider serves the test certificate, which the browser does not know.
test.use({ ignoreHTTPSErrors: true });

const loginHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Log in', exact: true });
const dashboardHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true });
const oidcButton = (page: Page) => page.getByRole('link', { name: 'Log in with OIDC' });

test.describe('OIDC from the environment', () => {
  test('opens on the login page with Log in with OIDC, never the onboarding page', async ({ page }) => {
    await page.goto('/');
    await expect(loginHeading(page)).toBeVisible();
    await expect(oidcButton(page)).toBeVisible();

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(loginHeading(page)).toBeVisible();
  });

  test('logs the administrator in, and offers OIDC again after Log out', async ({ page }) => {
    await page.goto('/');
    await oidcButton(page).click();

    await expect(dashboardHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(loginHeading(page)).toBeVisible();
    await expect(oidcButton(page)).toBeVisible();
  });

  test('has no accessibility violations on the login page', async ({ page }) => {
    await page.goto('/login');
    await expect(oidcButton(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
