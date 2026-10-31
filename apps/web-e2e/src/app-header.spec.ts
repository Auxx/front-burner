import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { logIn, TEST_ADMIN } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
const accountButton = (page: Page) => page.getByRole('button', { name: `Account menu for ${TEST_ADMIN.displayName}` });

/** Logs in from `/` and waits for the dashboard with its header. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await logIn(page);
  await expect(heading(page, 'Dashboard')).toBeVisible();
  await expect(accountButton(page)).toBeVisible();
}

test.describe('app header', () => {
  test('has Dashboard, Repositories and the user menu', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the phone layout has its own test');
    await openDashboard(page);

    const banner = page.getByRole('banner');
    const navigation = banner.getByRole('navigation');
    await expect(navigation.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(navigation.getByRole('link', { name: 'Repositories' })).not.toHaveAttribute('aria-current');
    await expect(banner.getByRole('button', { name: /^Account menu for / })).toHaveText('A');
  });

  test('leads to the repositories, which are not built yet, and back', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the phone layout has its own test');
    await openDashboard(page);
    const navigation = page.getByRole('banner').getByRole('navigation');

    await navigation.getByRole('link', { name: 'Repositories' }).click();
    await expect(page).toHaveURL(/\/repositories$/);
    await expect(heading(page, 'This page doesn\'t exist.')).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Repositories' })).toHaveAttribute('aria-current', 'page');

    await navigation.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(heading(page, 'Dashboard')).toBeVisible();
  });

  test('moves nothing when the current link changes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the phone layout shows the links in a Menu');
    await openDashboard(page);
    const navigation = page.getByRole('banner').getByRole('navigation');
    const repositories = navigation.getByRole('link', { name: 'Repositories' });
    const boxes = async () => [ await repositories.boundingBox(), await accountButton(page).boundingBox() ];

    const onDashboard = await boxes();
    await page.goto('/repositories/new');
    await expect(heading(page, 'Add repository')).toBeVisible();
    await expect(repositories).toHaveAttribute('aria-current', 'page');

    expect(await boxes()).toEqual(onDashboard);
  });

  test('shows the user in the user menu', async ({ page }) => {
    await openDashboard(page);
    await accountButton(page).click();

    const menu = page.getByRole('menu');
    await expect(menu).toContainText(TEST_ADMIN.displayName);
    await expect(menu).toContainText(TEST_ADMIN.email);
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
  });

  test('logs out every tab', async ({ page, context }) => {
    await openDashboard(page);
    const other = await context.newPage();
    await other.goto('/');
    await expect(heading(other, 'Dashboard')).toBeVisible();

    await accountButton(page).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();

    await expect(heading(page, 'Log in')).toBeVisible();
    await expect(heading(other, 'Log in')).toBeVisible();
    await expect(other.getByText('You have been logged out')).toBeVisible();
  });

  test('puts the links in a Menu on a phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'only the mobile projects have a phone viewport of their own');
    await openDashboard(page);
    const banner = page.getByRole('banner');

    await expect(banner.getByRole('link', { name: 'Repositories' })).toBeHidden();
    await banner.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Repositories' }).click();
    await expect(heading(page, 'This page doesn\'t exist.')).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });

  test('does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openDashboard(page);
    await expect(page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });

  test('starts with Skip to content, and moves the focus to the new page\'s heading', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tab moves the focus only with a keyboard');
    await openDashboard(page);
    await page.reload();
    await expect(accountButton(page)).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();

    await page.getByRole('banner').getByRole('link', { name: 'Repositories' }).click();
    await expect(heading(page, 'This page doesn\'t exist.')).toBeFocused();
    await expect(page.locator('shell-route-announcer [aria-live]')).toHaveText('Page not found · Front Burner');
  });

  test('opens and closes the user menu with the keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a phone has no keyboard');
    await openDashboard(page);

    await accountButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(accountButton(page)).toBeFocused();
  });

  test('has no accessibility violations', async ({ page }) => {
    await openDashboard(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Page not found', () => {
  test('shows "This page doesn\'t exist." without the header when logged out', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(heading(page, 'This page doesn\'t exist.')).toBeVisible();
    await expect(page).toHaveTitle('Page not found · Front Burner');
    await expect(page.getByRole('banner')).toBeEmpty();
    await page.getByRole('link', { name: 'Go to the dashboard' }).click();
    await expect(heading(page, 'Log in')).toBeVisible();
  });

  test('shows it with the header when logged in', async ({ page }) => {
    await openDashboard(page);
    await page.goto('/no-such-page');
    await expect(heading(page, 'This page doesn\'t exist.')).toBeVisible();
    await expect(accountButton(page)).toBeVisible();
    await page.getByRole('link', { name: 'Go to the dashboard' }).click();
    await expect(heading(page, 'Dashboard')).toBeVisible();
  });
});

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  );
}
