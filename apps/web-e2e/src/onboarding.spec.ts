import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { TEST_TOKEN } from './support/instance';

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Set up Front Burner', exact: true });

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function enterToken(page: Page, token = TEST_TOKEN): Promise<void> {
  await page.getByLabel('Setup token', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function reachPasswordStep(page: Page): Promise<void> {
  await page.goto('/');
  await enterToken(page);
  await expect(page.getByRole('heading', { name: 'Create the first administrator' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Administrator account' })).toBeVisible();
}

/**
 * Drains the console error a browser logs for the expected 404 of a refused
 * setup token; any other error still fails the test.
 */
function drainExpected404(monitor: { consoleErrors: { text: string; url: string; }[]; }): void {
  const expected = monitor.consoleErrors.filter(error => /404|Not Found/i.test(error.text));
  monitor.consoleErrors.splice(
    0,
    monitor.consoleErrors.length,
    ...monitor.consoleErrors.filter(error => !expected.includes(error))
  );
}

test.describe('administrator onboarding', () => {
  for (const url of [ '/', '/login', '/no/such/page' ]) {
    test(`AC1 any URL shows the onboarding page: ${url}`, async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(heading(page)).toBeVisible();
      await expect(page).toHaveTitle('Set up Front Burner · Front Burner');
    });
  }

  test.describe('without a setup token', () => {
    test.use({ instanceOptions: {} });

    test('explains how to set it', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'A setup token is needed' })).toBeVisible();
      await expect(page.getByText('FRONT_BURNER_SETUP_TOKEN', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Setup token', { exact: true })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
  });

  test('shows an invalid setup token', async ({ page, monitor }) => {
    await page.goto('/');
    await enterToken(page, 'not-the-right-token-at-all');
    await expect(page.getByText('This setup token isn\'t valid.')).toBeVisible();
    await expect(page.getByLabel('Setup token', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    drainExpected404(monitor);
  });

  test('happy path ends on the login page', async ({ page }) => {
    await reachPasswordStep(page);

    await page.getByLabel('Email address').fill('admin@example.com');
    await page.getByLabel('Display name').fill('Admin');
    const meter = page.getByRole('meter', { name: 'Password strength' });
    await expect(meter).toHaveAttribute('aria-valuetext', 'No password yet');

    await page.getByLabel('Password', { exact: true }).fill('abc');
    await expect(page.locator('li[data-rule="too-short"]')).toHaveAttribute('data-met', 'false');
    await expect(meter).toHaveAttribute('aria-valuetext', 'Weak');

    await page.getByLabel('Password', { exact: true }).fill('violet staircase 42');
    await expect(page.locator('li[data-rule="too-short"]')).toHaveAttribute('data-met', 'true');
    await expect(meter).not.toHaveAttribute('aria-valuetext', 'Weak');

    await page.getByLabel('Confirm password').fill('violet staircase 42');
    await page.getByRole('button', { name: 'Create administrator' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByText('Administrator account created.', { exact: false })
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('has no accessibility violations on any step', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Setup token', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await enterToken(page);
    await expect(page.getByRole('heading', { name: 'Create the first administrator' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Administrator account' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('abc');
    await expectNoAxeViolations(page);
  });

  test('does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await reachPasswordStep(page);
    await page.getByLabel('Password', { exact: true }).fill('abc');
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(fits).toBe(true);
  });
});
