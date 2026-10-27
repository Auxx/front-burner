import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test as base } from './support/fixtures';
import { TEST_TOKEN } from './support/instance';
import { OIDC_EMAIL, type OidcProvider, startOidcProvider, TEST_CERTIFICATE_FILE } from './support/oidc-provider';

// Each test has its own provider, which the instance trusts.
const test = base.extend<{ provider: OidcProvider; }>({
  // Playwright reads a fixture's dependencies from this pattern; this one has none.
  // eslint-disable-next-line no-empty-pattern
  provider: async ({}, use) => {
    const provider = await startOidcProvider();
    try {
      await use(provider);
    } finally {
      await provider.stop();
    }
  }
});

// The provider serves the test certificate, which the browser does not know.
test.use({ ignoreHTTPSErrors: true, instanceOptions: { setupToken: TEST_TOKEN, extraCaFile: TEST_CERTIFICATE_FILE } });

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function enterToken(page: Page): Promise<void> {
  await page.getByLabel('Setup token', { exact: true }).fill(TEST_TOKEN);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test.describe('administrator onboarding with OIDC', () => {
  const oidcHeading = (page: Page) => page.getByRole('heading', { name: 'OIDC provider' });

  async function reachOidcStep(page: Page): Promise<void> {
    await page.goto('/');
    await enterToken(page);
    await expect(page.getByRole('heading', { name: 'Create the first administrator' })).toBeVisible();
    // The radio itself is visually hidden; its label is what the user clicks.
    await page.getByText('OIDC', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'OIDC' })).toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(oidcHeading(page)).toBeVisible();
  }

  async function fillOidcStep(page: Page, provider: OidcProvider): Promise<void> {
    await page.getByLabel('Issuer URL').fill(provider.issuer);
    await page.getByLabel('Client ID').fill('front-burner');
    await page.getByLabel('Client secret', { exact: true }).fill('web-e2e-client-secret');
    await page.getByLabel('Administrator email address').fill(OIDC_EMAIL);
  }

  const save = (page: Page) => page.getByRole('button', { name: 'Save and continue to login' }).click();

  test('criterion 6: from the setup token to the dashboard', async ({ page, provider }) => {
    await reachOidcStep(page);
    await expect(page.getByLabel('Redirect URI')).toHaveValue(/\/api\/v1\/auth\/oidc\/callback$/);
    await fillOidcStep(page, provider);
    await save(page);

    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('link', { name: 'Log in with OIDC' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toBeVisible();

    // Onboarding is closed for good; the administrator is logged in.
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/$/);
  });

  test('criterion 7: a failed login comes back to the pre-filled form with the reason', async ({ page, provider }) => {
    await reachOidcStep(page);
    await fillOidcStep(page, provider);
    await save(page);
    await expect(page).toHaveURL(/\/login$/);

    provider.failTokenRequest(401);
    await page.getByRole('link', { name: 'Log in with OIDC' }).click();
    await expect(page).toHaveURL(/\/onboarding\?oidcError=code-exchange-failed$/);

    // The token is not kept (AO-11): it is asked for again.
    await enterToken(page);
    await expect(oidcHeading(page)).toBeVisible();
    await expect(page.getByText('The OIDC provider refused to exchange the login code.', { exact: false }))
      .toBeVisible();
    await expect(page.getByLabel('Issuer URL')).toHaveValue(provider.issuer);
    await expect(page.getByLabel('Client secret', { exact: true })).toHaveValue('');
    await expect(page.getByText('Leave blank to keep the saved secret.')).toBeVisible();

    await save(page);
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('link', { name: 'Log in with OIDC' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toBeVisible();
  });

  test('has no accessibility violations on the OIDC step', async ({ page }) => {
    await reachOidcStep(page);
    await expectNoAxeViolations(page);
    await page.getByLabel('Issuer URL').fill('http://id.example.com');
    await page.getByLabel('Issuer URL').blur();
    await expect(page.getByText('Enter an HTTPS address.')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await reachOidcStep(page);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(fits).toBe(true);
  });
});
