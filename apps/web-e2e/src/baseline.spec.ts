import type { Locator, Page } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './support/fixtures';
import { settled } from './support/hands';
import { type Instance, logIn, onboard, seed } from './support/instance';
import { ADMIN_ID, workingCopyOf } from './support/repositories';
import { gitIn } from './support/working-copy';

/*
 * The checks of the non-functional requirements that apply to every page
 * alike (plan 149). Each test walks the same list of pages, with the dialogs
 * and menus they open, in one instance seeded with a repository in each state
 * that has a page of its own. A new page is one more entry of `pages`.
 */

/** The IDs of the seeded repositories. */
interface Seeded {
  /** Ready, with the handbook's files. */
  handbook: number;
  /** Its clone failed: its settings page offers to clone it again. */
  failed: number;
  /** A merge is in progress: the repository screen shows conflict resolution. */
  conflicted: number;
}

interface Screen {
  /** How a failure names it. */
  name: string;
  path(ids: Seeded): string;
  /** The page's title once it has loaded (NV-13). */
  title: string | RegExp;
  /**
   * What the page shows once it has loaded, in the state it was seeded for,
   * if more than `main`: also what it loads late, such as the editor, which
   * the walk must not leave while it loads.
   */
  shows?(page: Page): Locator[];
  /** Opens a dialog or menu of the page, which is checked as a page of its own; returns it. */
  open?(page: Page): Promise<Locator>;
}

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
/** The editor of `README.md`, which the repository screen loads late (ED-4). */
const editor = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'README.md', exact: true });

/** Every page of a logged-in user, with the dialogs and menus that have a layout of their own. */
const pages: readonly Screen[] = [
  {
    name: 'the dashboard, with the account menu',
    path: () => '/',
    title: 'Dashboard · Front Burner',
    open: async page => {
      await page.getByRole('button', { name: /^Account menu for / }).click();
      return page.getByRole('menu');
    }
  },
  { name: 'the repository management page', path: () => '/repositories', title: 'Repositories · Front Burner' },
  { name: 'the Add repository page', path: () => '/repositories/new', title: 'Add repository · Front Burner' },
  {
    name: 'a repository\'s settings, with the Remove dialog',
    path: ids => `/repositories/${ids.handbook}/settings`,
    title: 'Settings · handbook · Front Burner',
    open: async page => {
      await page.getByRole('region', { name: 'Remove repository' }).getByRole('button', { name: 'Remove repository' })
        .click();
      return dialog(page, 'Remove handbook?');
    }
  },
  {
    name: 'a failed clone\'s settings',
    path: ids => `/repositories/${ids.failed}/settings`,
    title: 'Settings · failed · Front Burner'
  },
  { name: 'Preferences', path: () => '/preferences', title: 'Preferences · Front Burner' },
  {
    name: 'the repository screen with a file open, with the branch list',
    path: ids => `/repositories/${ids.handbook}/files/README.md`,
    title: 'README.md · handbook · Front Burner',
    shows: page => [ editor(page) ],
    open: async page => {
      await page.getByRole('banner').getByRole('button', { name: 'Branch main: open the branch list' }).click();
      return dialog(page, 'Branches');
    }
  },
  {
    // With the conflicting file open, as the screen opens it on its own.
    name: 'the repository screen during a merge',
    path: ids => `/repositories/${ids.conflicted}/files/README.md`,
    title: 'README.md · conflicted · Front Burner',
    shows: page => [ page.getByRole('banner').locator('rs-merge-summary'), editor(page) ]
  },
  { name: 'Page not found', path: () => '/no-such-page', title: 'Page not found · Front Burner' }
];

/** Seeds the repositories of `pages`; the instance must be onboarded. */
function seedRepositories(instance: Instance): Seeded {
  const [ handbook, failed, conflicted ] = seed(instance.dataDir, {
    repositories: [
      { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' },
      { userId: ADMIN_ID, name: 'failed', status: 'error', errorCode: 'clone-failed' },
      { userId: ADMIN_ID, name: 'conflicted', workingCopy: 'handbook' }
    ]
  }).repositoryIds as [ number, number, number ];
  // Both branches change the README's heading, so the merge stops with a conflict.
  const dir = workingCopyOf(instance.dataDir, conflicted);
  gitIn(dir, 'switch', '-q', '-c', 'other');
  writeFileSync(join(dir, 'README.md'), '# Theirs\n');
  gitIn(dir, 'commit', '-q', '-am', 'theirs');
  gitIn(dir, 'switch', '-q', 'main');
  writeFileSync(join(dir, 'README.md'), '# Mine\n');
  gitIn(dir, 'commit', '-q', '-am', 'mine');
  try {
    gitIn(dir, 'merge', '-q', 'other');
  } catch {
    // The conflict this wants.
  }
  expect(existsSync(join(dir, '.git', 'MERGE_HEAD')), 'a merge is in progress').toBe(true);
  return { handbook, failed, conflicted };
}

/**
 * Opens every page of `pages`, and the onboarding and login pages before them,
 * and calls `check` on each once it has loaded and settled, then on the
 * dialog or menu it opens, if any. Returns every problem `check` found, each
 * after the name of its page, so that one run reports them all.
 */
async function visitEveryPage(
  page: Page,
  instance: Instance,
  check: (opened?: Locator) => Promise<string[]>
): Promise<string[]> {
  const problems: string[] = [];
  const checkPage = async (name: string, opened?: Locator) => {
    problems.push(...(await check(opened)).map(problem => `${name}: ${problem}`));
  };

  await page.goto('/onboarding');
  await expect(page).toHaveTitle('Set up Front Burner · Front Burner');
  await settled(page);
  await checkPage('the onboarding page');

  await onboard(instance.url);
  const ids = seedRepositories(instance);

  await page.goto('/login');
  await expect(page).toHaveTitle('Log in · Front Burner');
  await settled(page);
  await checkPage('the login page');
  await logIn(page);
  // The dashboard the login lands on, with its list of repositories.
  await expect(page).toHaveTitle('Dashboard · Front Burner');
  await expect(page.getByRole('main').getByText('handbook').first()).toBeVisible();
  await fontsLoaded(page);

  for (const screen of pages) {
    await page.goto(screen.path(ids));
    await expect(page, screen.name).toHaveTitle(screen.title);
    for (const shown of screen.shows?.(page) ?? [ page.getByRole('main') ]) {
      await expect(shown, screen.name).toBeVisible();
    }
    await fontsLoaded(page);
    await settled(page);
    await checkPage(screen.name);
    if (screen.open) {
      const opened = await screen.open(page);
      await expect(opened, screen.name).toBeVisible();
      await settled(page);
      await checkPage(`${screen.name}, opened`, opened);
      await page.keyboard.press('Escape');
      await expect(opened, screen.name).toBeHidden();
    }
  }
  return problems;
}

/** Waits for the fonts the page uses: leaving a page while they load aborts them, which Firefox logs as errors. */
async function fontsLoaded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Whether the document scrolls sideways. */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/** Whether `locator`'s box lies inside the viewport, with a pixel for rounding. */
async function insideViewport(page: Page, locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  return box !== null && viewport !== null && box.x >= -1 && box.y >= -1
    && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
}

/**
 * What moves on the page: every running animation that changes more than
 * opacity, and every element with a transition longer than zero of anything
 * but opacity. A fade is not motion: the spinner's and progress bar's slow
 * pulse under reduced motion shows that something runs, and the CDK fades its
 * dialog backdrop in a millisecond (NF-13.7).
 */
function moving(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const label = (element: Element | null | undefined) =>
      element ? `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className)}` : ''}` : '?';
    const found: string[] = [];
    for (const animation of document.getAnimations()) {
      const effect = animation.effect as KeyframeEffect | null;
      if (!effect || Number(effect.getComputedTiming().duration ?? 0) === 0) {
        continue;
      }
      const properties = effect.getKeyframes().flatMap(frame => Object.keys(frame))
        .filter(key => ![ 'offset', 'computedOffset', 'easing', 'composite' ].includes(key));
      if (properties.some(property => property !== 'opacity')) {
        found.push(`${label(effect.target)}: ${properties.join(', ')}`);
      }
    }
    for (const element of document.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      const durations = style.transitionDuration.split(',').map(duration => parseFloat(duration));
      // The lists repeat when one is shorter than the other, as CSS does.
      const properties = style.transitionProperty.split(',').map(property => property.trim());
      const moved = durations
        .map((duration, index) => ({ duration, property: properties[index % properties.length] }))
        .filter(({ duration, property }) => duration > 0 && property !== 'opacity');
      if (moved.length > 0) {
        found.push(`${label(element)}: transition of ${style.transitionProperty} for ${style.transitionDuration}`);
      }
    }
    return found;
  });
}

test.describe('the first load', () => {
  test('NF-2.7: a first load asks for i18n/en.json once and breaks no CSP rule', async ({ page, instance, browserName }) => {
    await onboard(instance.url);
    await page.goto('/login');
    await logIn(page);
    await expect(page).toHaveTitle('Dashboard · Front Burner');
    await fontsLoaded(page);

    const translations: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/i18n/en.json') {
        translations.push(request.url());
      }
    });
    await page.goto('/');
    await expect(page).toHaveTitle('Dashboard · Front Burner');
    await expect(page.getByRole('main')).toBeVisible();

    // The server preloads the route's chunks and the translations (A-7.9), each with the page's nonce: the
    // fixture fails the test on any `securitypolicyviolation`.
    const preloads = await page.locator('head link[rel="modulepreload"][nonce]').count();
    expect(preloads, 'the dashboard\'s chunks are preloaded').toBeGreaterThan(2);
    await expect(page.locator('head link[rel="preload"][href="i18n/en.json"]')).toHaveCount(1);
    // The client's own request is answered by the preload, not sent again.
    // WebKit preloads it but does not give the preload to `fetch`, which asks
    // for it again, even with the preload's own headers (A-8.19 in
    // docs/architecture/web-client.md).
    expect(translations).toHaveLength(browserName === 'webkit' ? 2 : 1);
    await fontsLoaded(page);
  });
});

test.describe('every page', () => {
  test('NF-12.4: no page or dialog scrolls sideways at 320 px', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 640 });

    const problems = await visitEveryPage(
      page,
      instance,
      async () => (await scrollsSideways(page)) ? [ 'scrolls sideways' ] : []
    );

    expect(problems).toEqual([]);
  });

  test('NF-12.6: every page works in landscape on a phone', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'The phone projects check it.');
    const { width, height } = page.viewportSize() ?? { width: 412, height: 839 };
    await page.setViewportSize({ width: Math.max(width, height), height: Math.min(width, height) });

    const problems = await visitEveryPage(page, instance, async opened => {
      const found = (await scrollsSideways(page)) ? [ 'scrolls sideways' ] : [];
      // A dialog or menu fits the short screen, and scrolls inside it if it must;
      // a page's first heading, or the repository screen's bar, can be seen.
      const shown = opened ?? page.getByRole('heading', { level: 1 }).or(page.getByRole('banner')).first();
      await shown.scrollIntoViewIfNeeded();
      return (await insideViewport(page, shown)) ? found : [ ...found, 'not inside the screen' ];
    });

    expect(problems).toEqual([]);
  });

  test('NF-13.7: reduced motion turns animations off', async ({ page, instance }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const problems = await visitEveryPage(page, instance, () => moving(page));

    expect(problems).toEqual([]);

    // An element moved with the motion tokens, as the components are: still under
    // reduced motion, and found by the same check once motion is welcome, so
    // that the empty list above means something.
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'motion-probe';
      probe.style.transition = 'rotate var(--ui-duration-fast)';
      document.body.append(probe);
    });
    expect(await moving(page)).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await moving(page)).toContainEqual(expect.stringMatching(/^div\.motion-probe: transition of rotate/));
  });
});
