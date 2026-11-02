import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { logIn, TEST_ADMIN } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

/** 254 characters, the longest email CA-10 allows. */
const LONG_EMAIL = `${'a'.repeat(242)}@example.com`;

const main = (page: Page) => page.getByRole('main');
const nameField = (page: Page) => page.getByRole('textbox', { name: 'Name' });
const emailField = (page: Page) => page.getByRole('textbox', { name: 'Email' });

async function openFromUserMenu(page: Page): Promise<void> {
  await page.goto('/');
  await logIn(page);
  await page.getByRole('button', { name: `Account menu for ${TEST_ADMIN.displayName}` }).click();
  await page.getByRole('menuitem', { name: 'Preferences' }).click();
  await expect(page).toHaveURL(/\/preferences$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Preferences' })).toBeVisible();
}

/** How far the commit author's section reaches below **Edit**: the place kept for "Saved" takes no room. */
function emptyRoomBelowEdit(page: Page): Promise<number> {
  return page.getByRole('button', { name: 'Edit' }).evaluate(button => {
    const section = button.closest('section') as HTMLElement;
    return Math.round(
      section.getBoundingClientRect().bottom - (button.parentElement as HTMLElement).getBoundingClientRect().bottom
    );
  });
}

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function axeViolations(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations;
}

test.describe('Preferences', () => {
  test('edits the default commit author from the user menu', async ({ page }) => {
    await openFromUserMenu(page);
    await expect(page).toHaveTitle('Preferences · Front Burner');
    await expect(main(page).getByText(TEST_ADMIN.email)).toBeVisible();
    expect(await emptyRoomBelowEdit(page)).toBe(0);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(nameField(page)).toHaveValue(TEST_ADMIN.displayName);
    await expect(nameField(page)).toBeFocused();
    await expect(page.getByText('Shown in the commit history to everyone who can read the repository.')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await nameField(page).fill('Ada <Lovelace');
    await emailField(page).fill('12345+ada@users.noreply.github.com');
    await emailField(page).blur();
    await nameField(page).blur();
    await expect(page.getByText('Use a name with letters or digits, without <, > or line breaks')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await nameField(page).fill('Ada Lovelace');
    const saving = page.waitForResponse(response => response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save' }).click();
    // Editing the default counts as confirming it (CA-12); the first commit's half comes with plan 54.
    expect(await (await saving).json()).toMatchObject({ confirmed: true });

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();
    await expect(main(page).getByText('12345+ada@users.noreply.github.com')).toBeVisible();

    await page.reload();
    await expect(main(page).getByText('Ada Lovelace')).toBeVisible();
    await expect(main(page).getByText('12345+ada@users.noreply.github.com')).toBeVisible();
  });

  test('does not scroll sideways at 320 px, with the longest email', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openFromUserMenu(page);
    expect(await fitsWidth(page)).toBe(true);

    await page.getByRole('button', { name: 'Edit' }).click();
    await emailField(page).fill(LONG_EMAIL);
    expect(await fitsWidth(page)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(main(page).getByText(LONG_EMAIL)).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('sends a visitor who is not logged in to the login page and back', async ({ page }) => {
    await page.goto('/preferences');
    await logIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Preferences' })).toBeVisible();
  });
});
