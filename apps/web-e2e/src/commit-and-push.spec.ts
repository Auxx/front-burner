import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { drainFailedRequests, expect, test } from './support/fixtures';
import { type GitHttpServer, startGitHttpServer, TEST_CERTIFICATE_FILE } from './support/git-http-server';
import {
  type GitSshServer,
  PROTECTED_KEY_PASSPHRASE,
  PROTECTED_KEY_PUBLIC,
  startGitSshServer
} from './support/git-ssh-server';
import { confirmCommitAuthor, logIn, seed, TEST_ADMIN } from './support/instance';
import { addOverApi, ADMIN_ID, escapeRegExp, sshRepository, workingCopyOf } from './support/repositories';
import { createWorkingCopy, gitIn } from './support/working-copy';

test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

const ADMIN_AUTHOR = `${TEST_ADMIN.displayName} <${TEST_ADMIN.email}>`;

/** A token the git server lets push, and later only read. */
const FIRST = { username: 'writer', password: 'first-token' };
/** The token that replaces it. */
const SECOND = { username: 'writer', password: 'second-token' };

const bar = (page: Page) => page.getByRole('banner');
const summary = (page: Page) => bar(page).locator('rs-git-status-summary');
const problem = (page: Page) => bar(page).locator('rs-git-problem');
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const toolWindows = (page: Page) => page.getByRole('toolbar', { name: 'Tool windows' });
const filesButton = (page: Page) => toolWindows(page).getByRole('button', { name: 'Files', exact: true });
const changesButton = (page: Page, name: string | RegExp = /^Changes/) =>
  toolWindows(page).getByRole('button', { name });
const changesPane = (page: Page) => page.getByRole('region', { name: 'Changes', exact: true });
const rows = (page: Page) => changesPane(page).getByRole('listitem');
const tree = (page: Page) => page.getByRole('tree', { name: 'Files' });
const entry = (page: Page, name: string) =>
  tree(page).getByRole('treeitem', { name: new RegExp(`^${escapeRegExp(name)},`) });
const editorOf = (page: Page, name: string) =>
  page.getByRole('main', { name: 'Editor' }).getByRole('textbox', { name, exact: true });
const diffLines = (page: Page) => page.locator('rs-diff-view .lines');
const changeButton = (page: Page, name: string) =>
  changesPane(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) });
const tick = (page: Page, path: string) =>
  changesPane(page).getByRole('checkbox', { name: `Commit ${path}`, exact: true });
const message = (page: Page) => changesPane(page).getByRole('textbox', { name: 'Commit message' });
const commitButton = (page: Page, name: string) => changesPane(page).getByRole('button', { name, exact: true });
const dialog = (page: Page, name?: string) => page.getByRole('dialog', name === undefined ? {} : { name });
const credentialsDialog = (page: Page) => dialog(page, 'Repository credentials');
const tooltip = (page: Page) => page.locator('ui-tooltip');

/** Waits for every animation, so that axe measures the colours a dialog ends with. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished)
    )
  );
}

async function axe(page: Page, ...selectors: string[]): Promise<void> {
  await settled(page);
  let builder = new AxeBuilder({ page });
  for (const selector of selectors) {
    builder = builder.include(selector);
  }
  expect((await builder.analyze()).violations).toEqual([]);
}

/**
 * How the walkthrough works the screen: with the keyboard alone on a desktop,
 * or by touch alone on a phone (GA-6, NF-12.5).
 */
interface Hands {
  /** Activates a button, a link or a menu item. */
  press(target: Locator): Promise<void>;
  /** Asks an unavailable button why: a keyboard press or a tap shows its reason (GA-8). */
  explain(target: Locator): Promise<void>;
  /** Ticks or unticks a checkbox. */
  toggle(target: Locator): Promise<void>;
  /** Types `text` at the end of a field or the editor. */
  typeInto(target: Locator, text: string): Promise<void>;
  /** Chooses the radio button `name` of `group`. */
  choose(group: Locator, name: string): Promise<void>;
  /** Opens a file from the file tree. */
  openFile(name: string): Promise<void>;
  /** Deletes a file from the file tree, confirming it. */
  deleteFile(name: string): Promise<void>;
  /** Shows **Changes**. */
  showChanges(): Promise<void>;
  /** **Push**: in the bar, or in the git actions menu on a phone (GA-7). */
  push(): Promise<void>;
}

/**
 * Presses Shift+Tab until `target` has the focus, and checks that the focus
 * can be seen (NF-13.3). Backwards, because the editor is the last control of
 * the page, and Firefox keeps the focus there on Tab. The editor takes Tab for
 * indenting until Escape is pressed (ED-11).
 */
async function tabTo(page: Page, target: Locator, limit = 150): Promise<void> {
  // A toolbar is one stop of Tab, and its arrow keys move between its buttons (NF-13.4).
  const orientation = await target.evaluate(element =>
    element.closest('[role="toolbar"]')?.getAttribute('aria-orientation') ?? null
  );
  const reached = () =>
    target.evaluate((element, inToolbar) => {
      const active = document.activeElement;
      return inToolbar ? element.closest('[role="toolbar"]')?.contains(active) === true : element === active;
    }, orientation !== null);
  for (let presses = 0; !(await reached()); presses++) {
    if (presses === limit) {
      throw new Error(`Shift+Tab did not reach ${target}`);
    }
    if (await page.evaluate(() => document.activeElement?.closest('.cm-editor') != null)) {
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Shift+Tab');
  }
  if (orientation !== null) {
    await arrowTo(page, target, orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
  }
  expect(await target.evaluate(element => element.matches(':focus-visible')), 'the focus is visible').toBe(true);
}

/** Presses `key` until `target` has the focus, such as an item of an open menu. */
async function arrowTo(page: Page, target: Locator, key = 'ArrowDown', limit = 20): Promise<void> {
  for (let presses = 0; presses < limit; presses++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press(key);
  }
  throw new Error(`${key} did not reach ${target}`);
}

function keyboard(page: Page): Hands {
  const hands: Hands = {
    press: async target => {
      await tabTo(page, target);
      await page.keyboard.press('Enter');
    },
    explain: async target => {
      await tabTo(page, target);
      await page.keyboard.press('Enter');
    },
    toggle: async target => {
      await tabTo(page, target);
      await page.keyboard.press('Space');
    },
    typeInto: async (target, text) => {
      await tabTo(page, target);
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(text);
    },
    choose: async (group, name) => {
      const radios = group.getByRole('radio');
      const checked = radios.and(group.locator(':checked'));
      await tabTo(page, (await checked.count()) > 0 ? checked : radios.first());
      await arrowTo(page, group.getByRole('radio', { name }));
      await expect(group.getByRole('radio', { name })).toBeChecked();
    },
    openFile: async name => {
      await tabTo(page, tree(page));
      await page.keyboard.type(name);
      await expectActive(page, name);
      await page.keyboard.press('Enter');
      await expect(editorOf(page, name)).toBeVisible();
    },
    deleteFile: async name => {
      await tabTo(page, tree(page));
      await page.keyboard.type(name);
      await expectActive(page, name);
      await page.keyboard.press('Shift+F10');
      await arrowTo(page, page.getByRole('menuitem', { name: 'Delete', exact: true }));
      await page.keyboard.press('Enter');
      // Cancel, the safe choice, has the focus.
      await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
      await hands.press(dialog(page).getByRole('button', { name: 'Delete', exact: true }));
      await expect(dialog(page)).toHaveCount(0);
    },
    showChanges: async () => {
      if (await changesButton(page).getAttribute('aria-pressed') === 'false') {
        await hands.press(changesButton(page));
      }
      await expect(changesPane(page)).toBeVisible();
    },
    push: async () => {
      await hands.press(bar(page).getByRole('button', { name: 'Push', exact: true }));
    }
  };
  return hands;
}

function touch(page: Page): Hands {
  const hands: Hands = {
    press: target => target.tap(),
    // `force`: Playwright waits for an `aria-disabled` button to be enabled, but a tap here says why.
    explain: target => target.tap({ force: true }),
    toggle: target => target.tap(),
    typeInto: async (target, text) => {
      await target.tap();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(text);
    },
    // The radio is visually hidden, so its label is tapped.
    choose: async (group, name) => {
      await group.getByText(name, { exact: true }).tap();
      await expect(group.getByRole('radio', { name })).toBeChecked();
    },
    openFile: async name => {
      await showTree();
      await entry(page, name).tap();
      // Opening a file closes the drawer (FB-9).
      await expect(tree(page)).toBeHidden();
      await expect(editorOf(page, name)).toBeVisible();
    },
    deleteFile: async name => {
      await showTree();
      await entry(page, name).getByRole('button', { name: `Actions for ${name}` }).tap();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).tap();
      await dialog(page).getByRole('button', { name: 'Delete', exact: true }).tap();
      await expect(dialog(page)).toHaveCount(0);
      await filesButton(page).tap();
      await expect(tree(page)).toBeHidden();
    },
    showChanges: async () => {
      if (await changesButton(page).getAttribute('aria-pressed') === 'false') {
        await changesButton(page).tap();
      }
      await expect(changesPane(page)).toBeVisible();
    },
    push: async () => {
      await bar(page).getByRole('button', { name: 'Git actions' }).tap();
      await page.getByRole('menuitem', { name: 'Push' }).tap();
    }
  };
  async function showTree(): Promise<void> {
    if (await filesButton(page).getAttribute('aria-pressed') === 'false') {
      await filesButton(page).tap();
    }
    await expect(tree(page)).toBeVisible();
  }
  return hands;
}

/** **Push** with the mouse or a tap, from the bar or its menu. */
async function pushFromBar(page: Page): Promise<void> {
  const gitActions = bar(page).getByRole('button', { name: 'Git actions' });
  const button = bar(page).getByRole('button', { name: 'Push', exact: true });
  await expect(button.or(gitActions)).toBeVisible();
  if (await gitActions.isVisible()) {
    await gitActions.click();
    await page.getByRole('menuitem', { name: 'Push' }).click();
  } else {
    await button.click();
  }
}

/** Points the tree's active row, by `aria-activedescendant`, at the entry. */
async function expectActive(page: Page, name: string): Promise<void> {
  await expect.poll(async () =>
    (await tree(page).getAttribute('aria-activedescendant')) === (await entry(page, name).getAttribute('id'))
  ).toBe(true);
}

async function openScreen(page: Page, url: string): Promise<void> {
  const opened = page.waitForResponse(response => /\/api\/v1\/repositories\/\d+\/open$/.test(response.url()));
  await page.goto(url);
  await logIn(page);
  await opened;
}

/**
 * Collects what the CDK live announcer says, so that a test can count how
 * often a banner was announced (RC-25).
 */
async function recordAnnouncements(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { announcements: string[]; }).announcements = said;
    new MutationObserver(records => {
      for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        const region = element?.closest('.cdk-live-announcer-element');
        const text = region?.textContent?.trim();
        if (region && text) {
          said.push(text);
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => [ ...(window as unknown as { announcements: string[]; }).announcements ]);
}

test.describe('commit and push', () => {
  let root: string;
  let git: GitHttpServer;
  /** The server's repositories, which each test adds to; anyone may read them, as public ones. */
  const remotes: Record<string, string> = {};
  /** Who may push, and who may only read; a test moves a token from one to the other. */
  const pushers: Record<string, string> = {};
  const readers: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-commit-and-push-'));
    git = await startGitHttpServer({ repositories: remotes, pushers, readers });
  });

  test.afterAll(async () => {
    await git?.close();
    rmSync(root, { recursive: true, force: true });
  });

  test.beforeEach(() => {
    pushers[FIRST.username] = FIRST.password;
    delete readers[FIRST.username];
  });

  /**
   * Adds a repository of a new remote with the handbook's files, over the API
   * with the token {@link FIRST}, as the Add repository page does, and waits
   * for its clone. Returns its ID, working copy and bare repository.
   */
  async function addHandbook(instance: { url: string; dataDir: string; }): Promise<{
    id: number;
    dir: string;
    bare: string;
  }> {
    const name = `handbook-${next++}`;
    const source = join(root, name, 'source');
    createWorkingCopy(source, 'handbook');
    const bare = join(root, name, 'handbook.git');
    gitIn(dirname(bare), 'clone', '-q', '--bare', source, bare);
    remotes[`${name}.git`] = bare;
    const { id, dir } = await addOverApi(instance, {
      name,
      remoteUrl: `${git.url}/${name}.git`,
      credentials: { mode: 'new-https', name: 'first token', ...FIRST }
    });
    return { id, dir, bare };
  }

  /**
   * Exit criterion 7: edits two files and deletes one; sees **Changes (3)**
   * and each diff; discards one; confirms the commit author; commits one of
   * the two left with a message; pushes and sees the counts go; then a push
   * fails for a token that may only read, and the banner's fix pushes.
   */
  async function walkThrough(page: Page, hands: Hands, instance: { url: string; dataDir: string; }) {
    const { id, dir, bare } = await addHandbook(instance);
    await openScreen(page, `/repositories/${id}`);
    await expect(editorOf(page, 'README.md')).toBeVisible();
    await expect(summary(page)).toHaveText('main');

    // Edit two files and delete one.
    // Each save is waited for, so that the tree it refreshes does not move under the next step.
    await hands.typeInto(editorOf(page, 'README.md'), 'Edited README. ');
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await hands.openFile('2-setup.md');
    await hands.typeInto(editorOf(page, '2-setup.md'), 'Edited setup. ');
    await expect(changesButton(page, 'Changes (2)')).toBeVisible();
    await hands.deleteFile('10-deploy.md');
    await expect(changesButton(page, 'Changes (3)')).toBeVisible();

    // See each diff.
    for (
      const [ name, line ] of [
        [ 'README.md', 'Edited README.' ],
        [ '2-setup.md', 'Edited setup.' ],
        [ '10-deploy.md', '# Deploy' ]
      ]
    ) {
      await hands.showChanges();
      await hands.press(changeButton(page, name));
      await expect(diffLines(page)).toContainText(line);
    }
    await expect(diffLines(page).locator('.row.removed')).toHaveCount(1);

    // Discard one.
    await hands.showChanges();
    await hands.press(changesPane(page).getByRole('button', { name: 'Discard 2-setup.md', exact: true }));
    await expect(dialog(page).getByRole('heading', { name: 'Discard changes to 1 file?' })).toBeVisible();
    await hands.press(dialog(page).getByRole('button', { name: 'Discard', exact: true }));
    await expect(changesButton(page, 'Changes (2)')).toBeVisible();
    expect(gitIn(dir, 'status', '--porcelain').split('\n').filter(Boolean).map(line => line.slice(3)).sort())
      .toEqual([ '10-deploy.md', 'README.md' ]);

    // Commit one of the two, confirming the commit author.
    await hands.showChanges();
    await hands.toggle(tick(page, '10-deploy.md'));
    await expect(tick(page, '10-deploy.md')).not.toBeChecked();
    await hands.typeInto(message(page), 'Edit the README');
    await hands.press(commitButton(page, 'Commit 1 file'));
    const question = dialog(page, 'Confirm your commit author');
    await expect(question).toBeVisible();
    await hands.press(question.getByRole('button', { name: `Commit as ${ADMIN_AUTHOR}`, exact: true }));
    await expect(question).toHaveCount(0);
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'show', '--name-only', '--format=%s|%an <%ae>', 'HEAD').trim().split('\n').filter(Boolean))
      .toEqual([ `Edit the README|${ADMIN_AUTHOR}`, 'README.md' ]);
    await expect(summary(page)).toHaveText(/main\s*·\s*1 to push/);

    // Push, and the count goes.
    await hands.push();
    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('Edit the README');

    // The token may only read now: the push fails, and the banner's fix pushes.
    delete pushers[FIRST.username];
    readers[FIRST.username] = FIRST.password;
    pushers[SECOND.username] = SECOND.password;
    await hands.showChanges();
    await hands.toggle(tick(page, '10-deploy.md'));
    await hands.typeInto(message(page), 'Remove the deploy notes');
    await hands.press(commitButton(page, 'Commit 1 file'));
    await expect(changesButton(page, /^Changes$/)).toBeVisible();
    await hands.push();
    await expect(problem(page)).toContainText('Your credentials can read this repository but not push to it.');
    await hands.press(problem(page).getByRole('button', { name: 'Use other credentials' }));
    await expect(credentialsDialog(page)).toBeVisible();
    await hands.choose(credentialsDialog(page).getByRole('radiogroup'), 'Add new credentials');
    await hands.typeInto(credentialsDialog(page).getByLabel('Credentials name'), 'second token');
    await hands.typeInto(credentialsDialog(page).getByLabel('Username'), SECOND.username);
    await hands.typeInto(credentialsDialog(page).getByLabel('Password or token', { exact: true }), SECOND.password);
    await hands.press(credentialsDialog(page).getByRole('button', { name: 'Save' }));

    await expect(credentialsDialog(page)).toHaveCount(0);
    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    await expect(problem(page)).toHaveCount(0);
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(bare, 'log', '-2', '--format=%s', 'main').trim().split('\n')).toEqual([
      'Remove the deploy notes',
      'Edit the README'
    ]);
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('');
  }

  test('exit criterion 7, on desktop with the keyboard alone', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'phones are used by touch');
    test.slow();
    await walkThrough(page, keyboard(page), instance);
  });

  test('exit criterion 7, on a phone by touch alone', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'touch is for phones');
    test.slow();
    await walkThrough(page, touch(page), instance);
  });

  test('a reload keeps the ticks, the counts and a running push', async ({ page, instance }) => {
    await confirmCommitAuthor(instance.url);
    const { id, dir, bare } = await addHandbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    writeFileSync(join(dir, 'new.md'), '# New\n');
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'to push');
    // The remote holds the push until the test lets it go, and for a minute at most if it never does.
    const release = join(root, `release-${next}`);
    const hook = join(bare, 'hooks', 'pre-receive');
    writeFileSync(
      hook,
      `#!/bin/sh\nwaited=0\nwhile [ ! -e '${release}' ] && [ $waited -lt 600 ]; do sleep 0.1; waited=$((waited + 1)); done\nexit 0\n`
    );
    chmodSync(hook, 0o755);
    try {
      await holdAndReload();
    } finally {
      writeFileSync(release, '');
    }
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('to push');

    async function holdAndReload(): Promise<void> {
      await openScreen(page, `/repositories/${id}`);
      await expect(summary(page)).toHaveText(/main\s*·\s*1 to push/);
      await expect(changesButton(page, 'Changes (2)')).toBeVisible();
      await changesButton(page).click();
      await tick(page, 'new.md').click();
      await expect(tick(page, 'new.md')).not.toBeChecked();

      await pushFromBar(page);
      const running = async () => {
        const gitActions = bar(page).getByRole('button', { name: 'Git actions' });
        if (await gitActions.isVisible()) {
          await expect(gitActions).toHaveAttribute('data-busy', 'true');
        } else {
          await expect(bar(page).getByRole('button', { name: 'Pushing…' })).toBeVisible();
        }
      };
      await running();

      await page.reload();

      await expect(summary(page)).toHaveText(/main\s*·\s*1 to push/);
      await running();
      await expect(changesButton(page, 'Changes (2)')).toBeVisible();
      if (await changesButton(page).getAttribute('aria-pressed') === 'false') {
        await changesButton(page).click();
      }
      await expect(tick(page, 'new.md')).not.toBeChecked();
      await expect(tick(page, 'README.md')).toBeChecked();
    }
  });
});

test.describe('every action, by touch and by keyboard', () => {
  /**
   * A repository of the handbook whose `main` is published with nothing to
   * push, with `README.md` changed far from its start, so that its diff folds,
   * and a new file.
   */
  async function published(instance: { url: string; dataDir: string; }): Promise<{ id: number; dir: string; }> {
    await confirmCommitAuthor(instance.url);
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' } ]
    }).repositoryIds;
    const dir = workingCopyOf(instance.dataDir, id);
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
    writeFileSync(join(dir, 'README.md'), `# Handbook\n${lines}\n`);
    gitIn(dir, 'commit', '-qam', 'longer');
    gitIn(dir, 'remote', 'add', 'origin', 'https://github.com/acme/handbook.git');
    gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    gitIn(dir, 'branch', '-q', '--set-upstream-to=origin/main');
    writeFileSync(join(dir, 'README.md'), `# Handbook\n${lines}\nThe end.\n`);
    writeFileSync(join(dir, 'new.md'), '# New\n');
    return { id, dir };
  }

  async function everyAction(page: Page, hands: Hands, isMobile: boolean, instance: { url: string; dataDir: string; }) {
    const { id, dir } = await published(instance);
    await openScreen(page, `/repositories/${id}/files/docs/guide.md`);
    await expect(summary(page)).toHaveText('main');
    await axe(page, 'rs-repository-bar');

    // Push is disabled, and says why (GA-8).
    if (isMobile) {
      await bar(page).getByRole('button', { name: 'Git actions' }).tap();
      await expect(page.getByRole('menuitem', { name: /Push/ })).toContainText('Nothing to push');
      await expect(page.getByRole('menuitem', { name: /Push/ })).toBeDisabled();
      await page.keyboard.press('Escape');
    } else {
      await hands.explain(bar(page).getByRole('button', { name: 'Push', exact: true }));
      await expect(tooltip(page)).toHaveText('Nothing to push');
      await page.keyboard.press('Escape');
    }

    // Commit is disabled until there is a message, and says why.
    await hands.showChanges();
    await expect(rows(page)).toHaveCount(2);
    await hands.explain(commitButton(page, 'Commit 2 files'));
    await expect(tooltip(page)).toHaveText('Write a commit message first.');
    await axe(page, 'rs-changes-pane');

    // All files, unticked and ticked again.
    const all = changesPane(page).getByRole('checkbox', { name: 'All files' });
    await hands.toggle(all);
    await expect(commitButton(page, 'Commit 0 files')).toBeVisible();
    await hands.toggle(all);
    await expect(commitButton(page, 'Commit 2 files')).toBeVisible();

    // The diff: open a fold, and Open in editor.
    await hands.press(changeButton(page, 'README.md'));
    await expect(diffLines(page)).toContainText('The end.');
    await axe(page, 'rs-diff-view');
    await hands.press(page.getByRole('button', { name: /^Show \d+ more lines$/ }).first());
    await expect(diffLines(page).getByText('line 20', { exact: true })).toBeVisible();
    await hands.press(page.getByRole('button', { name: 'Open in editor' }));
    await expect(editorOf(page, 'README.md')).toBeVisible();

    // Change the commit author.
    await hands.showChanges();
    await hands.press(changesPane(page).getByRole('button', { name: 'Change commit author' }));
    const change = dialog(page, 'Change the commit author');
    await expect(change).toBeVisible();
    await axe(page, 'dlg-change-commit-author');
    await hands.typeInto(change.getByRole('textbox', { name: 'Name' }), ' Lovelace');
    await hands.press(change.getByRole('button', { name: 'Save' }));
    await expect(change).toHaveCount(0);
    const author = `${TEST_ADMIN.displayName} Lovelace <${TEST_ADMIN.email}>`;
    await expect(changesPane(page).getByText(`Committing as ${author}`, { exact: true })).toBeVisible();

    // Commit one file, then amend its message.
    await hands.showChanges();
    await hands.toggle(tick(page, 'new.md'));
    await hands.typeInto(message(page), 'First try');
    await hands.press(commitButton(page, 'Commit 1 file'));
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await hands.showChanges();
    await hands.toggle(changesPane(page).getByRole('checkbox', { name: 'Amend last commit' }));
    await expect(message(page)).toHaveValue('First try');
    await hands.typeInto(message(page), ', amended');
    await hands.press(commitButton(page, 'Amend'));
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'log', '-1', '--format=%s|%an').trim()).toBe(
      `First try, amended|${TEST_ADMIN.displayName} Lovelace`
    );
    await expect(summary(page)).toHaveText(/1 to push/);
    await axe(page, 'rs-repository-bar', 'rs-changes-pane');

    // Discard all.
    await hands.showChanges();
    await hands.press(changesPane(page).getByRole('button', { name: 'Discard all' }));
    await expect(dialog(page).getByRole('heading', { name: 'Discard changes to 1 file?' })).toBeVisible();
    await axe(page, 'rs-discard-changes');
    await hands.press(dialog(page).getByRole('button', { name: 'Discard', exact: true }));
    await expect(changesPane(page).getByText('No changes since the last commit.')).toBeVisible();
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('');
  }

  test('AC-GIT-002.21: every action can be done by touch alone and with the keyboard alone, and axe-core reports no violations in the header, Changes and the diff', async ({ page, instance, isMobile }) => {
    test.slow();
    await everyAction(page, isMobile ? touch(page) : keyboard(page), isMobile, instance);
  });
});

test.describe('the credential dialogs and the banner', () => {
  let root: string;
  let ssh: GitSshServer;
  let git: GitHttpServer;
  const sshRemotes: Record<string, string> = {};
  const httpsRemotes: Record<string, string> = {};

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-dialogs-'));
    ssh = await startGitSshServer({ repositories: sshRemotes, authorizedKeys: [ PROTECTED_KEY_PUBLIC ] });
    git = await startGitHttpServer({ repositories: httpsRemotes, pushers: { writer: 'push-token' } });
  });

  test.afterAll(async () => {
    await Promise.all([ ssh?.close(), git?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  const banner = (page: Page) => page.locator('rs-locked-key-banner');

  /** Opens a dialog with `opener`, checks where the focus goes and axe, and cancels it: the focus goes back. */
  async function focusRoundTrip(page: Page, opener: Locator, opened: Locator, first: Locator, selector: string) {
    await opener.click();
    await expect(opened).toBeVisible();
    await expect(first).toBeFocused();
    await axe(page, selector);
    await page.keyboard.press('Escape');
    await expect(opened).toHaveCount(0);
    await expect(opener).toBeFocused();
  }

  test('RC-25: the dialogs move focus to their first field and return it, and the banner is announced once', async ({ page, instance, monitor }) => {
    test.slow();
    const announcements = await recordAnnouncements(page);

    // The locked-key banner and the unlock dialog.
    const { id } = await sshRepository(instance, ssh, sshRemotes, join(root, 'locked'));
    await openScreen(page, `/repositories/${id}`);
    const message = 'laptop is locked. Unlock it to fetch, pull and push.';
    await expect(banner(page)).toContainText(message);
    await axe(page, 'rs-locked-key-banner');
    const unlock = dialog(page, 'Unlock laptop');
    await focusRoundTrip(
      page,
      banner(page).getByRole('button', { name: 'Unlock' }),
      unlock,
      unlock.getByLabel('Passphrase'),
      'dlg-unlock-key'
    );
    // A status read and the dialog coming and going do not announce it again.
    await expect.poll(async () => (await announcements()).filter(text => text.includes(message))).toHaveLength(1);
    await page.waitForTimeout(500);
    expect((await announcements()).filter(text => text.includes(message))).toHaveLength(1);

    await banner(page).getByRole('button', { name: 'Unlock' }).click();
    await unlock.getByLabel('Passphrase').fill(PROTECTED_KEY_PASSPHRASE);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(banner(page)).toHaveCount(0);

    // The changed host key dialog: its first control is Cancel, the safe choice (plan 66).
    await ssh.changeHostKey();
    await pushFromBar(page);
    const heading = 'The server\'s identity has changed. This may be an attack.';
    await expect(problem(page)).toContainText(heading);
    await expect.poll(async () => (await announcements()).filter(text => text.includes(heading))).toHaveLength(1);
    const changed = dialog(page, heading);
    await focusRoundTrip(
      page,
      problem(page).getByRole('button', { name: 'Review the new key' }),
      changed,
      changed.getByRole('button', { name: 'Cancel' }),
      'dlg-changed-host-key'
    );

    // The credentials dialog, from a push without credentials.
    const parent = join(root, 'public');
    mkdirSync(parent, { recursive: true });
    const source = join(parent, 'source');
    createWorkingCopy(source, 'empty');
    const bare = join(parent, 'public.git');
    gitIn(parent, 'clone', '-q', '--bare', source, bare);
    httpsRemotes['public.git'] = bare;
    const remoteUrl = `${git.url}/public.git`;
    const [ publicId ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: 'public', remoteUrl } ]
    }).repositoryIds;
    const dir = workingCopyOf(instance.dataDir, publicId);
    rmSync(dir, { recursive: true, force: true });
    gitIn(dirname(dir), 'clone', '-q', bare, dir);
    gitIn(dir, 'remote', 'set-url', 'origin', remoteUrl);
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    await page.goto(`/repositories/${publicId}`);
    await expect(summary(page)).toHaveText(/1 to push/);
    await pushFromBar(page);
    await expect(problem(page)).toContainText('This repository has no credentials.');
    const credentials = credentialsDialog(page);
    await focusRoundTrip(
      page,
      problem(page).getByRole('button', { name: 'Add credentials' }),
      credentials,
      credentials.getByRole('radio', { name: 'Add new credentials' }),
      'dlg-repository-credentials'
    );
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/push`);
    drainFailedRequests(monitor, `/api/v1/repositories/${publicId}/git/push`);
  });
});
