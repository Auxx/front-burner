import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { axe } from './support/hands';
import { logIn, seed, TEST_ADMIN } from './support/instance';
import { ADMIN_ID } from './support/repositories';
import { answerWithVersion } from './support/versions';

test.use({ instanceOptions: { onboarded: true } });

/** A phone's width (NF-12.2). */
const PHONE = { width: 360, height: 740 };

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
const accountButton = (page: Page) => page.getByRole('button', { name: `Account menu for ${TEST_ADMIN.displayName}` });
const navigationLink = (page: Page, name: 'Dashboard' | 'Repositories') =>
  page.getByRole('banner').getByRole('navigation').getByRole('link', { name, exact: true });
const menuButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true });
const menuItem = (page: Page, name: 'Dashboard' | 'Repositories') => page.getByRole('menuitem', { name, exact: true });
/** The repository name in the repository screen's bar, which opens the repository switcher (NV-10). */
const switcherButton = (page: Page) => page.getByRole('banner').getByRole('heading').getByRole('button');

/** Adds the ready repository `handbook`, with an empty working copy. */
function seedHandbook(dataDir: string): number[] {
  return seed(dataDir, { repositories: [ { userId: ADMIN_ID, name: 'handbook' } ] }).repositoryIds;
}

/**
 * The pages that have the app header for a logged-in user, with their headings
 * (NV-1, NV-3). The repository screen's bar has tests of its own.
 */
function pages(handbook: number): { url: string; name: string; }[] {
  return [
    { url: '/', name: 'Dashboard' },
    { url: '/repositories', name: 'Repositories' },
    { url: '/repositories/new', name: 'Add repository' },
    { url: `/repositories/${handbook}/settings`, name: 'Settings' },
    { url: '/preferences', name: 'Preferences' },
    { url: '/no-such-page', name: 'This page doesn\'t exist.' }
  ];
}

/** The app header, and the overlay that an open menu of it is moved into. */
const HEADER = 'ui-app-shell > header';
const OVERLAY = '.cdk-overlay-container';

/** Opens the repository screen of `id`, and waits for it to have opened the repository. */
async function openRepositoryScreen(page: Page, id: number): Promise<void> {
  const opened = page.waitForResponse(response => /\/api\/v1\/repositories\/\d+\/open$/.test(response.url()));
  await page.goto(`/repositories/${id}`);
  await opened;
  await expect(switcherButton(page)).toBeVisible();
}

/** Follows the app header's link `name`: in the bar on wide screens, in the Menu on a phone (NV-6). */
async function follow(page: Page, name: 'Dashboard' | 'Repositories', isMobile: boolean): Promise<void> {
  if (isMobile) {
    await menuButton(page).click();
    await menuItem(page, name).click();
  } else {
    await navigationLink(page, name).click();
  }
}

/** The links marked as the current page, for screen readers: in the bar, or in the Menu on a phone. */
async function currentLinks(page: Page, inMenu: boolean): Promise<string[]> {
  if (!inMenu) {
    // The closed Menu's items stay in the navigation, hidden.
    const names = await page.getByRole('banner').getByRole('navigation').locator('a[aria-current="page"]:visible')
      .allInnerTexts();
    return names.map(name => name.trim());
  }
  await menuButton(page).click();
  const items = page.getByRole('menu').locator('a[aria-current="page"]');
  await expect(page.getByRole('menu')).toBeVisible();
  const names = await items.allInnerTexts();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  return names.map(name => name.trim());
}

/** Logs in from `/` and waits for the dashboard with its header. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await logIn(page);
  await expect(heading(page, 'Dashboard')).toBeVisible();
  await expect(accountButton(page)).toBeVisible();
}

test.describe('app header', () => {
  test('AC-APP-001.1: every page that needs a login has the app header with Dashboard, Repositories and the user menu; the login page has no app header', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedHandbook(instance.dataDir);
    await openDashboard(page);

    for (const { url, name } of pages(handbook)) {
      await page.goto(url);
      await expect(heading(page, name)).toBeVisible();
      await expect(navigationLink(page, 'Dashboard')).toBeVisible();
      await expect(accountButton(page)).toHaveText('A');
      if (isMobile) {
        await menuButton(page).click();
        await expect(menuItem(page, 'Dashboard')).toBeVisible();
        await expect(menuItem(page, 'Repositories')).toBeVisible();
        await page.keyboard.press('Escape');
      } else {
        await expect(navigationLink(page, 'Repositories')).toBeVisible();
      }
    }

    // The repository screen's bar: Repositories is in the repository switcher (NV-9, NV-10).
    await openRepositoryScreen(page, handbook);
    await expect(page.getByRole('banner').getByRole('link', { name: /^(Front Burner|Dashboard)$/ })).toBeVisible();
    await expect(accountButton(page)).toBeVisible();
    await switcherButton(page).click();
    await expect(page.getByRole('menuitem', { name: 'All repositories' })).toHaveAttribute('href', '/repositories');
    await page.keyboard.press('Escape');

    await accountButton(page).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(heading(page, 'Log in')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('fills the user menu button with the island shade, so that it shows on the canvas in both schemes', async ({ page }) => {
    await openDashboard(page);
    for (const colorScheme of [ 'dark', 'light' ] as const) {
      await page.emulateMedia({ colorScheme });
      const shades = await accountButton(page).evaluate(button => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--ui-surface-island)';
        document.body.append(probe);
        const island = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { button: getComputedStyle(button).backgroundColor, island };
      });
      expect(shades.button).toBe(shades.island);
    }
  });

  test('AC-APP-001.2: Dashboard leads to the dashboard and Repositories to the repository management page; the current page\'s link is marked as current', async ({ page, isMobile }) => {
    await openDashboard(page);
    expect(await currentLinks(page, isMobile)).toEqual([ 'Dashboard' ]);

    await follow(page, 'Repositories', isMobile);
    await expect(page).toHaveURL(/\/repositories$/);
    await expect(heading(page, 'Repositories')).toBeVisible();
    expect(await currentLinks(page, isMobile)).toEqual([ 'Repositories' ]);

    await follow(page, 'Dashboard', isMobile);
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page, 'Dashboard')).toBeVisible();
    expect(await currentLinks(page, isMobile)).toEqual([ 'Dashboard' ]);
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

  test('the user menu shows the display name, email and version', async ({ page }) => {
    await openDashboard(page);
    await accountButton(page).click();

    const menu = page.getByRole('menu');
    await expect(menu).toContainText(TEST_ADMIN.displayName);
    await expect(menu).toContainText(TEST_ADMIN.email);
    // The web client's own version, which is the backend's (A-8.7).
    const version = (await page.request.get('/api/v1/auth/methods')).headers()['x-front-burner-version'];
    expect(version).toBeTruthy();
    await expect(menu).toContainText(`Front Burner ${version}`);
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

  test('AC-APP-001.4: on a phone, the links are in a Menu button, and nothing scrolls sideways', async ({ page, instance }) => {
    const [ handbook ] = seedHandbook(instance.dataDir);
    await page.setViewportSize(PHONE);
    await openDashboard(page);

    for (const { url, name } of pages(handbook)) {
      await page.goto(url);
      await expect(heading(page, name)).toBeVisible();
      await expect(navigationLink(page, 'Repositories')).toBeHidden();
      await expect(menuButton(page)).toBeVisible();
      expect(await fitsWidth(page), `${url} fits 360 px`).toBe(true);
    }

    await page.goto('/');
    await expect(heading(page, 'Dashboard')).toBeVisible();
    await menuButton(page).click();
    await menuItem(page, 'Repositories').click();
    await expect(heading(page, 'Repositories')).toBeVisible();
    expect(await currentLinks(page, true)).toEqual([ 'Repositories' ]);
    expect(await fitsWidth(page)).toBe(true);
  });

  test('NF-12.4: does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openDashboard(page);
    await expect(page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });

  test('AC-APP-001.12: Skip to content is the first element reached with Tab; after moving to another page, focus is on its heading and a screen reader announces its title', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'Tab moves the focus only with a keyboard');
    const [ handbook ] = seedHandbook(instance.dataDir);
    await openDashboard(page);

    for (const { url, name } of pages(handbook)) {
      await page.goto(url);
      await expect(heading(page, name)).toBeVisible();
      await expect(accountButton(page)).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to content' }), `on ${url}`).toBeFocused();
    }

    // Each step moves to another page inside the web client, as a user does.
    const announcer = page.locator('shell-route-announcer [aria-live]');
    const steps: { go: () => Promise<void>; name: string; title: string; }[] = [
      {
        go: () => navigationLink(page, 'Repositories').click(),
        name: 'Repositories',
        title: 'Repositories · Front Burner'
      },
      {
        go: () => page.getByRole('main').getByRole('link', { name: 'handbook', exact: true }).click(),
        name: 'Settings',
        title: 'Settings · handbook · Front Burner'
      },
      {
        go: () =>
          page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Repositories' }).click(),
        name: 'Repositories',
        title: 'Repositories · Front Burner'
      },
      {
        go: () => page.getByRole('main').getByRole('link', { name: 'Add repository' }).click(),
        name: 'Add repository',
        title: 'Add repository · Front Burner'
      },
      {
        go: async () => {
          await accountButton(page).click();
          await page.getByRole('menuitem', { name: 'Preferences' }).click();
        },
        name: 'Preferences',
        title: 'Preferences · Front Burner'
      },
      { go: () => navigationLink(page, 'Dashboard').click(), name: 'Dashboard', title: 'Dashboard · Front Burner' }
    ];
    for (const { go, name, title } of steps) {
      await go();
      await expect(heading(page, name)).toBeFocused();
      await expect(page).toHaveTitle(title);
      await expect(announcer).toHaveText(title);
    }
  });

  test('AC-APP-001.13: the menus open and close with the keyboard, Esc returns focus to their button, and axe-core reports no violations in the app header', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'a phone has no keyboard');
    const [ handbook ] = seedHandbook(instance.dataDir);
    await openDashboard(page);

    // The user menu.
    await accountButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Preferences' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeFocused();
    await axe(page, HEADER, OVERLAY);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(accountButton(page)).toBeFocused();

    // The Menu button of narrow screens.
    const wide = page.viewportSize();
    if (!wide) {
      throw new Error('the desktop projects have a viewport of their own');
    }
    await page.setViewportSize(PHONE);
    await axe(page, HEADER);
    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(menuItem(page, 'Dashboard')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Repositories')).toBeFocused();
    await axe(page, HEADER, OVERLAY);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    await page.setViewportSize(wide);

    // The repository switcher, in the repository screen's bar (NV-9).
    await openRepositoryScreen(page, handbook);
    await axe(page, HEADER);
    await switcherButton(page).focus();
    const listed = page.waitForResponse(response => response.url().includes('/api/v1/repositories/recent?exclude='));
    await page.keyboard.press('Enter');
    await listed;
    await expect(page.getByRole('menuitem', { name: 'All repositories' })).toBeVisible();
    await expect(page.getByText('Loading your repositories')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[role="menuitem"]:focus')).toHaveCount(1);
    await axe(page, HEADER, OVERLAY);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(switcherButton(page)).toBeFocused();

    for (const { url, name } of pages(handbook)) {
      await page.goto(url);
      await expect(heading(page, name)).toBeVisible();
      await expect(accountButton(page)).toBeVisible();
      await axe(page, HEADER);
    }
  });

  test('AC-APP-001.11: after a new version is deployed, every page shows "A new version of Front Burner is available." with Reload; turning the network off shows the offline banner, which goes away when the network returns', async ({ page, context }) => {
    await openDashboard(page);
    const newVersion = page.getByRole('banner').getByText('A new version of Front Burner is available.');
    const offline = page.getByRole('banner').getByText(
      'You\'re offline. Changes are kept and saved when you\'re back online.'
    );
    await expect(newVersion).toBeHidden();

    const upgraded = await answerWithVersion(page, '999.0.0');
    for (const [ url, name ] of [ [ '/repositories', 'Repositories' ], [ '/', 'Dashboard' ] ]) {
      await page.goto(url);
      await expect(heading(page, name)).toBeVisible();
      await expect(newVersion).toBeVisible();
    }

    // The reloaded web client is the new version, which matches the backend.
    await upgraded();
    await page.getByRole('banner').getByRole('button', { name: 'Reload' }).click();
    await expect(heading(page, 'Dashboard')).toBeVisible();
    await expect(accountButton(page)).toBeVisible();
    await expect(newVersion).toBeHidden();

    // The banner's icon comes from the cached sprite: no request fails, which the monitor checks.
    // Once the toast outlet, loaded when the reloaded page is idle, is there: going offline
    // would cut its chunk short.
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeAttached();
    await context.setOffline(true);
    await expect(offline).toBeVisible();
    await context.setOffline(false);
    await expect(offline).toBeHidden();
  });

  test('NF-13.8: has no accessibility violations', async ({ page }) => {
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

test.describe('low-space banner', () => {
  // A threshold above any runner's free space.
  test.use({ instanceOptions: { onboarded: true, env: { FRONT_BURNER_LOW_DISK_THRESHOLD: '1000000GB' } } });

  // The banners are part of the app header; the live announcer has the same text.
  const lowSpace = (page: Page) =>
    page.getByRole('banner').getByText(
      'The server is running low on storage. New repositories can\'t be added until space is freed.'
    );

  test('NF-9.7: an administrator sees the low-space banner, below the app header, and it cannot be dismissed', async ({ page }) => {
    await openDashboard(page);

    await expect(lowSpace(page)).toBeVisible();
    await expect(page.locator('ui-inline-banner.low-storage').getByRole('button')).toHaveCount(0);
  });

  test('NF-9.7: a user who is not an administrator sees no banner and never asks', async ({ page, instance }) => {
    seed(instance.dataDir, { users: [ { email: 'bob@example.com' } ] });
    const asked: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/v1/instance/storage')) {
        asked.push(request.url());
      }
    });

    await page.goto('/');
    await logIn(page, 'bob@example.com');
    await expect(heading(page, 'Dashboard')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();

    await expect(lowSpace(page)).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  );
}
