import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { drainFailedRequests, expect, type Monitor, test } from './support/fixtures';
import {
  createHandbookRemote,
  type GitHttpServer,
  pushFromElsewhere,
  startGitHttpServer,
  TEST_CERTIFICATE_FILE
} from './support/git-http-server';
import {
  type GitSshServer,
  PROTECTED_KEY_PASSPHRASE,
  PROTECTED_KEY_PUBLIC,
  startGitSshServer
} from './support/git-ssh-server';
import { axe, type Hands, keyboard as keyboardHands, recordAnnouncements, touch as touchHands } from './support/hands';
import { confirmCommitAuthor, logIn, seed } from './support/instance';
import { ADMIN_ID, escapeRegExp, sshRepository, workingCopyOf } from './support/repositories';
import { gitIn } from './support/working-copy';

/*
 * Step 4 end to end: exit criteria 8, 9 and 10 of the MVP, walked through with
 * the keyboard alone on a desktop and by touch alone on a phone, and the
 * criteria of conflict resolution that span the whole screen.
 */

test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

const bar = (page: Page) => page.getByRole('banner');
const summary = (page: Page) => bar(page).locator('rs-git-status-summary');
const mergeSummary = (page: Page) => bar(page).locator('rs-merge-summary');
const problem = (page: Page) => bar(page).locator('rs-git-problem');
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const main = (page: Page) => page.getByRole('main');
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const branchButton = (page: Page, name: string) =>
  bar(page).getByRole('button', { name: `Branch ${name}: open the branch list` });
const branchList = (page: Page) => dialog(page, 'Branches');
/** A row of the branch list; the current branch's name is followed by "Current branch". */
const branchRow = (page: Page, name: string) =>
  branchList(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) });
const remoteNotice = (page: Page) => page.locator('rs-remote-change-notice');
const mergeNotice = (page: Page) => page.locator('rs-merge-committed');
const lockedBanner = (page: Page) => page.locator('rs-locked-key-banner');
const conflictsItem = (page: Page) =>
  page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', { name: 'Conflicting files' });
const conflictList = (page: Page) => page.getByRole('list', { name: 'Conflicting files' });
/** A file of the conflict list: its name, followed by its folder, sizes, kind and state. */
const conflictEntry = (page: Page, name: string) =>
  conflictList(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}\\s`) });
const shownFile = (page: Page, name: string) => main(page).getByRole('heading', { name, exact: true });
const offer = (page: Page, name: string) => main(page).getByRole('button', { name, exact: true });
const editorOf = (page: Page, name: string) => main(page).getByRole('textbox', { name, exact: true });
const conflictBar = (page: Page) => main(page).getByRole('group', { name: 'Conflicts' });
/** An **Accept** button inside the editor, for pointer and touch; hidden from assistive technology. */
const widget = (page: Page, name: string) =>
  main(page).locator('.cm-conflict-action').filter({ hasText: name }).first();

const MERGE_COMMITTED = 'Merge committed. Push to publish it.';
const MERGE_BLOCKED = 'This pull would overwrite ignored files. Move them first.';

/** A PNG's signature and a NUL, which make git treat the file as binary, then `text`. */
const png = (text: string) => `\u0089PNG\r\n\u001a\n\0${text}`;

/** `guide.md` with `text` as its third line. */
const guide = (text: string) => `# Guide\n\n${text}\n`;

/** A git action of the bar with the mouse: its button, or the item of the git actions menu on a phone. */
async function clickGitAction(page: Page, name: string): Promise<void> {
  const repositoryBar = page.locator('rs-repository-bar');
  const button = repositoryBar.getByRole('button', { name, exact: true });
  const gitActions = repositoryBar.getByRole('button', { name: /^Git actions/ });
  await expect(button.or(gitActions)).toBeVisible();
  if (await gitActions.isVisible()) {
    await gitActions.click();
    await page.getByRole('menuitem', { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
  } else {
    await button.click();
  }
}

async function openScreen(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await logIn(page);
}

/** {@link Hands}, with what these walkthroughs do on the repository screen. */
interface ScreenHands extends Hands {
  /** Shows the conflicting files: beside the editor on wide screens, and a drawer on phones (GC-7, FB-9). */
  showConflicts(): Promise<void>;
  /** Selects a conflicting file in the list, which shows it. */
  selectConflict(name: string): Promise<void>;
  /** Replaces the first conflict of the editor with their side: the conflict bar's on a desktop, the editor's own button on a phone. */
  acceptTheirs(): Promise<void>;
  /**
   * Leaves the editor, so that the file's choices are there: on a phone they
   * make way while the focus is in the editor (NF-12.5). The keyboard leaves
   * it on its own, with Escape.
   */
  leaveEditor(): Promise<void>;
}

function keyboard(page: Page): ScreenHands {
  const hands: ScreenHands = {
    ...keyboardHands(page),
    showConflicts: async () => {
      if (await conflictsItem(page).getAttribute('aria-pressed') === 'false') {
        await hands.press(conflictsItem(page));
      }
      await expect(conflictList(page)).toBeVisible();
    },
    selectConflict: async name => {
      await hands.showConflicts();
      await hands.press(conflictEntry(page, name));
      await expect(shownFile(page, name)).toBeVisible();
    },
    acceptTheirs: async () => {
      // From wherever the cursor is, Next moves it into a conflict, where the bar's Accept buttons act.
      await hands.press(conflictBar(page).getByRole('button', { name: 'Next', exact: true }));
      await hands.press(conflictBar(page).getByRole('button', { name: 'Accept theirs', exact: true }));
    },
    leaveEditor: () => Promise.resolve()
  };
  return hands;
}

function touch(page: Page): ScreenHands {
  const hands: ScreenHands = {
    ...touchHands(page),
    showConflicts: async () => {
      if (await conflictsItem(page).getAttribute('aria-pressed') === 'false') {
        await conflictsItem(page).tap();
      }
      await expect(conflictList(page)).toBeVisible();
    },
    selectConflict: async name => {
      await hands.showConflicts();
      await conflictEntry(page, name).tap();
      await expect(shownFile(page, name)).toBeVisible();
    },
    acceptTheirs: () => widget(page, 'Accept theirs').tap(),
    // A tap on text that takes no focus, such as the bar's count, takes it from
    // the editor. WebKit's iPhone keeps it there, as iOS does until the
    // on-screen keyboard's Done, which blurs the editor.
    leaveEditor: async () => {
      await mergeSummary(page).locator('.count').tap();
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest('.cm-editor')) {
          active.blur();
        }
      });
    }
  };
  return hands;
}

/** Every file of a working copy, outside `.git`, by its hash; `HEAD`; the index; and `git status`. */
function snapshot(dir: string): Record<string, unknown> {
  const files: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' || folder !== dir) {
          walk(path);
        }
      } else {
        files[relative(dir, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
      }
    }
  };
  walk(dir);
  return {
    files,
    head: gitIn(dir, 'rev-parse', 'HEAD').trim(),
    index: gitIn(dir, 'ls-files', '--stage'),
    status: gitIn(dir, 'status', '--porcelain=v2', '--branch', '--untracked-files=all', '--ignored')
  };
}

/** Writes `files` (path → content) into the working copy `dir` and commits them. */
function commitHere(dir: string, files: Readonly<Record<string, string>>, message: string): void {
  for (const [ path, content ] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  gitIn(dir, 'add', '--', ...Object.keys(files));
  gitIn(dir, 'commit', '-q', '-m', message);
}

/**
 * Commits `files` and pushes them: to the bare repository itself, as a
 * blocking git call here would wait for the server that this process runs.
 */
function publish(dir: string, bare: string, files: Readonly<Record<string, string>>): void {
  commitHere(dir, files, 'published');
  gitIn(dir, 'push', '-q', bare, 'HEAD:main');
  gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

/** Selects `to` in the branch list, which the button of the current branch `from` opens. */
async function switchBranch(page: Page, hands: Hands, from: string, to: string): Promise<void> {
  await hands.press(branchButton(page, from));
  await expect(branchRow(page, to)).toBeVisible();
  await hands.press(branchRow(page, to));
  await expect(branchList(page)).toHaveCount(0);
}

/** Commits the merge from the bar with git's message, as the dialog offers it. */
async function commitMerge(page: Page, hands: Hands): Promise<void> {
  await hands.gitAction('Commit merge');
  const commit = dialog(page, 'Commit merge');
  await expect(commit.getByRole('textbox', { name: 'Commit message' })).toHaveValue(/^Merge .*origin\/main/);
  await hands.press(commit.getByRole('button', { name: 'Commit merge', exact: true }));
  await expect(commit).toHaveCount(0);
  await expect(mergeNotice(page)).toContainText(MERGE_COMMITTED);
}

/** Removes the errors of merge reads that answered `409` because the merge had just ended, which the store takes as its end. */
function drainMergeReads(monitor: Monitor, id: number): void {
  drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/merge`);
}

/** Checks the page's `selectors` with axe-core in the light and the dark colour scheme. */
async function axeBothSchemes(page: Page, ...selectors: string[]): Promise<void> {
  for (const colorScheme of [ 'dark', 'light' ] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page, ...selectors);
  }
}

test.describe('pulling and conflicts', () => {
  let root: string;
  let git: GitHttpServer;
  let ssh: GitSshServer;
  /** The git servers' repositories, which each test adds to; anyone may read and push the HTTPS ones. */
  const remotes: Record<string, string> = {};
  const sshRemotes: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-pull-and-conflicts-'));
    git = await startGitHttpServer({ repositories: remotes });
    ssh = await startGitSshServer({ repositories: sshRemotes, authorizedKeys: [ PROTECTED_KEY_PUBLIC ] });
  });

  test.afterAll(async () => {
    await Promise.all([ git?.close(), ssh?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * A repository cloned from a new remote on the HTTPS server, which has
   * `main` and `feature/x`, with `files` published on `main`. Returns its ID,
   * working copy and bare repository.
   */
  function cloned(
    instance: { dataDir: string; },
    files: Readonly<Record<string, string>>
  ): { id: number; dir: string; bare: string; } {
    const name = `remote-${next++}`;
    const parent = join(root, name);
    mkdirSync(parent, { recursive: true });
    const bare = createHandbookRemote(parent);
    remotes[`${name}.git`] = bare;
    const remoteUrl = `${git.url}/${name}.git`;
    const [ id ] = seed(instance.dataDir, { repositories: [ { userId: ADMIN_ID, name, remoteUrl } ] }).repositoryIds;
    const dir = workingCopyOf(instance.dataDir, id);
    rmSync(dir, { recursive: true, force: true });
    gitIn(dirname(dir), 'clone', '-q', bare, dir);
    gitIn(dir, 'remote', 'set-url', 'origin', remoteUrl);
    publish(dir, bare, files);
    return { id, dir, bare };
  }

  /**
   * A repository whose next pull conflicts on `guide.md` and on `logo.png`,
   * which both sides changed. Its commit author is confirmed.
   */
  async function conflicting(instance: { url: string; dataDir: string; }): Promise<{
    id: number;
    dir: string;
    bare: string;
  }> {
    await confirmCommitAuthor(instance.url);
    const repository = cloned(instance, { 'guide.md': guide('before'), 'logo.png': png('before') });
    commitHere(repository.dir, { 'guide.md': guide('mine'), 'logo.png': png('mine') }, 'mine');
    pushFromElsewhere(repository.bare, 'main', [ { 'guide.md': guide('theirs'), 'logo.png': png('theirs') } ]);
    return repository;
  }

  /** Exit criterion 8: creates a branch, switches away and back, tracks a remote branch, and pulls. */
  async function walkThroughBranches(
    page: Page,
    hands: Hands,
    instance: { url: string; dataDir: string; },
    monitor: Monitor
  ) {
    const { id, dir, bare } = cloned(instance, { 'README.md': '# Notes\n' });
    await openScreen(page, `/repositories/${id}`);
    await expect(summary(page)).toHaveText('main');

    // Create a branch.
    await hands.press(branchButton(page, 'main'));
    await hands.press(branchList(page).getByRole('button', { name: 'New branch', exact: true }));
    const newBranch = dialog(page, 'New branch');
    await hands.typeInto(newBranch.getByRole('textbox', { name: 'Name' }), 'drafts');
    await hands.press(newBranch.getByRole('button', { name: 'Create branch', exact: true }));
    await expect(newBranch).toHaveCount(0);
    await expect(summary(page)).toHaveText(/drafts\s*·\s*Not published/);
    expect(gitIn(dir, 'branch', '--show-current').trim()).toBe('drafts');

    // Switch away and back.
    await switchBranch(page, hands, 'drafts', 'main');
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(dir, 'branch', '--show-current').trim()).toBe('main');
    await switchBranch(page, hands, 'main', 'drafts');
    await expect(summary(page)).toHaveText(/drafts\s*·\s*Not published/);

    // Track a remote branch.
    await switchBranch(page, hands, 'drafts', 'origin/feature/x');
    await expect(summary(page)).toHaveText('feature/x');
    expect(gitIn(dir, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/feature/x');

    // Pull.
    pushFromElsewhere(bare, 'feature/x', [ { 'feature.md': '# Feature\n' } ]);
    await hands.gitAction('Pull');
    await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
    await expect(summary(page)).toHaveText('feature/x');
    expect(readFileSync(join(dir, 'feature.md'), 'utf8')).toBe('# Feature\n');
    // feature/x has no README.md: the editor's check of the open file gone with the switch (ED-21).
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/file/state`);
  }

  test('exit criterion 8, on desktop with the keyboard alone', async ({ page, instance, isMobile, monitor }) => {
    test.skip(isMobile, 'phones are used by touch');
    test.slow();
    await walkThroughBranches(page, keyboardHands(page), instance, monitor);
  });

  test('exit criterion 8, on a phone by touch alone', async ({ page, instance, isMobile, monitor }) => {
    test.skip(!isMobile, 'touch is for phones');
    test.slow();
    await walkThroughBranches(page, touchHands(page), instance, monitor);
  });

  /**
   * Exit criterion 9, in three rounds. A commit pushed elsewhere shows the
   * notice; its **Pull** conflicts on a Markdown file and a PNG; the first is
   * resolved with **Accept theirs** and an edit, the second with **Use my
   * version**; the merge is committed and pushed. Then a pull that conflicts
   * is aborted, and everything is as it was. Then the remote starts tracking a
   * file that the user has ignored: the pull refuses, and the file stays.
   */
  async function walkThroughConflicts(
    page: Page,
    hands: ScreenHands,
    instance: { url: string; dataDir: string; },
    monitor: Monitor
  ) {
    const { id, dir, bare } = await conflicting(instance);
    // Ignored here, and later tracked by the remote.
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'build/\n');
    mkdirSync(join(dir, 'build'));
    writeFileSync(join(dir, 'build', 'out.md'), 'Built here.\n');
    const merged = guide('theirs').replace(/\n$/, '\nEdited after the merge.');

    // The notice, from the fetch made when the file is opened.
    await openScreen(page, `/repositories/${id}/files/guide.md`);
    await expect(remoteNotice(page)).toContainText('1 new commit on origin/main', { timeout: 15_000 });
    await expect(remoteNotice(page)).toContainText('This file changed too.');
    await hands.press(remoteNotice(page).getByRole('button', { name: 'Pull', exact: true }));
    await expect(mergeSummary(page)).toContainText('0 of 2 files resolved');

    // The Markdown file: Accept theirs, an edit, and Mark as resolved.
    await expect(shownFile(page, 'guide.md')).toBeVisible();
    await expect(editorOf(page, 'guide.md')).toContainText('<<<<<<< main');
    await hands.acceptTheirs();
    await expect(editorOf(page, 'guide.md')).not.toContainText('<<<<<<<');
    await hands.typeInto(editorOf(page, 'guide.md'), 'Edited after the merge.');
    await expect.poll(() => readFileSync(join(dir, 'guide.md'), 'utf8'), { timeout: 40_000 }).toBe(merged);
    await hands.leaveEditor();
    await hands.press(offer(page, 'Mark as resolved'));
    await expect(mergeSummary(page)).toContainText('1 of 2 files resolved');

    // The PNG, which the screen moves on to: Use my version.
    await expect(shownFile(page, 'logo.png')).toBeVisible();
    await hands.press(offer(page, 'Use my version'));
    await expect(mergeSummary(page)).toContainText('2 of 2 files resolved');

    // Commit merge, and Push.
    await commitMerge(page, hands);
    await expect(summary(page)).toHaveText(/main\s*·\s*2 to push/);
    await hands.press(mergeNotice(page).getByRole('button', { name: 'Push', exact: true }));
    await expect(mergeNotice(page)).toHaveCount(0);
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(bare, 'rev-parse', 'main').trim()).toBe(gitIn(dir, 'rev-parse', 'HEAD').trim());
    expect(gitIn(bare, 'show', 'main:guide.md')).toBe(merged);
    expect(gitIn(bare, 'show', 'main:logo.png')).toBe(png('mine'));
    expect(gitIn(bare, 'rev-list', '--parents', '-1', 'main').trim().split(' ')).toHaveLength(3);

    // Round two: another conflict, with a file resolved, then Abort merge.
    commitHere(dir, { 'guide.md': guide('mine again') }, 'mine again');
    pushFromElsewhere(bare, 'main', [ { 'guide.md': guide('theirs again') } ]);
    await hands.gitAction('Fetch');
    await expect(summary(page)).toHaveText(/main\s*·\s*1 to push, 1 to pull/);
    const before = snapshot(dir);
    await hands.gitAction('Pull');
    await expect(mergeSummary(page)).toContainText('0 of 1 file resolved');
    await expect(shownFile(page, 'guide.md')).toBeVisible();
    await hands.leaveEditor();
    await hands.press(offer(page, 'Use their version'));
    await expect(mergeSummary(page)).toContainText('1 of 1 file resolved');
    expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe(guide('theirs again'));

    await hands.gitAction('Abort merge');
    const abort = dialog(page, 'Abort the merge?');
    await hands.press(abort.getByRole('button', { name: 'Abort merge', exact: true }));
    await expect(abort).toHaveCount(0);
    await expect(summary(page)).toHaveText(/main\s*·\s*1 to push, 1 to pull/);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    await expect(editorOf(page, 'guide.md')).toContainText('mine again');

    // Round three: the remote now tracks build/out.md, which is ignored here.
    pushFromElsewhere(bare, 'main', [ { 'build/out.md': 'Built there.\n' } ]);
    const head = gitIn(dir, 'rev-parse', 'HEAD').trim();
    await hands.gitAction('Pull');
    await expect(problem(page)).toContainText(MERGE_BLOCKED);
    await expect(problem(page).getByRole('listitem')).toHaveText([ 'build/out.md' ]);
    await expect(mergeSummary(page)).toHaveCount(0);
    expect(readFileSync(join(dir, 'build', 'out.md'), 'utf8')).toBe('Built here.\n');
    expect(gitIn(dir, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    drainMergeReads(monitor, id);
  }

  test('exit criterion 9, on desktop with the keyboard alone', async ({ page, instance, isMobile, monitor }) => {
    test.skip(isMobile, 'phones are used by touch');
    test.slow();
    await walkThroughConflicts(page, keyboard(page), instance, monitor);
  });

  test('exit criterion 9, on a phone by touch alone', async ({ page, instance, isMobile, monitor }) => {
    test.skip(!isMobile, 'touch is for phones');
    test.slow();
    await walkThroughConflicts(page, touch(page), instance, monitor);
  });

  test('exit criterion 10, on desktop', async ({ page, instance, isMobile, monitor }) => {
    test.skip(
      isMobile,
      'It waits for the scheduler and restarts the backend, which do not depend on the layout; the banner and the unlock dialog on a phone have tests of their own.'
    );
    // Two restarts, and waiting twice for a fetch that must not run.
    test.slow();
    const unlock = dialog(page, 'Unlock laptop');
    const { id, bare } = await sshRepository(instance, ssh, sshRemotes, join(root, `locked-${next++}`));
    const dir = workingCopyOf(instance.dataDir, id);
    const remoteBranches = () => gitIn(dir, 'branch', '-r', '--format=%(refname:short)').trim().split('\n');
    publish(dir, bare, { 'guide.md': guide('before'), 'intro.md': guide('before') });
    commitHere(dir, { 'guide.md': guide('mine'), 'intro.md': guide('my intro') }, 'mine');
    pushFromElsewhere(bare, 'main', [ { 'guide.md': guide('theirs'), 'intro.md': guide('their intro') } ]);

    // After a restart the key is locked: the banner shows, and no fetch runs.
    await instance.restart();
    await openScreen(page, `/repositories/${id}`);
    await expect(lockedBanner(page)).toContainText('laptop is locked.');
    await expect(summary(page)).toHaveText(/main\s*·\s*1 to push/);
    // Longer than the scheduler's 5 seconds between looks at what is viewed.
    await page.waitForTimeout(7_000);
    await expect(summary(page)).not.toHaveText(/to pull/);

    // Pull asks for the passphrase, and carries on.
    await clickGitAction(page, 'Pull');
    await expect(unlock).toBeVisible();
    await unlock.getByLabel('Passphrase').fill(PROTECTED_KEY_PASSPHRASE);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(mergeSummary(page)).toContainText('0 of 2 files resolved');
    await expect(lockedBanner(page)).toHaveCount(0);
    await expect(shownFile(page, 'guide.md')).toBeVisible();
    await offer(page, 'Use their version').click();
    await expect(mergeSummary(page)).toContainText('1 of 2 files resolved');

    // A restart during the merge keeps it, and its resolution; the key is locked again.
    await page.goto('about:blank');
    await instance.restart();
    pushFromElsewhere(bare, 'later', [ {} ]);
    await page.goto(`/repositories/${id}`);
    await expect(mergeSummary(page)).toContainText('1 of 2 files resolved');
    await expect(lockedBanner(page)).toContainText('laptop is locked.');
    await page.waitForTimeout(7_000);
    expect(remoteBranches()).not.toContain('origin/later');

    // Unlocking carries on: the fetches resume, and the merge is committed and pushed.
    await lockedBanner(page).getByRole('button', { name: 'Unlock' }).click();
    await unlock.getByLabel('Passphrase').fill(PROTECTED_KEY_PASSPHRASE);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(lockedBanner(page)).toHaveCount(0);
    await expect.poll(remoteBranches, { timeout: 15_000 }).toContain('origin/later');
    await expect(shownFile(page, 'intro.md')).toBeVisible();
    await offer(page, 'Use my version').click();
    await expect(mergeSummary(page)).toContainText('2 of 2 files resolved');
    await clickGitAction(page, 'Commit merge');
    await dialog(page, 'Commit merge').getByRole('button', { name: 'Commit merge', exact: true }).click();
    await mergeNotice(page).getByRole('button', { name: 'Push', exact: true }).click();
    await expect.poll(() => gitIn(bare, 'rev-parse', 'main').trim()).toBe(gitIn(dir, 'rev-parse', 'HEAD').trim());
    await expect(mergeNotice(page)).toHaveCount(0);
    expect(gitIn(bare, 'show', 'main:guide.md')).toBe(guide('theirs'));
    expect(gitIn(bare, 'show', 'main:intro.md')).toBe(guide('my intro'));
    // The pull refused for the locked key, which opened the unlock dialog.
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/pull`);
    drainMergeReads(monitor, id);
  });

  test('AC-GIT-003.10: resolving one file on a phone and the other on a desktop, then committing, works; no lease expires in between', async ({ page, browser, instance, isMobile, monitor }) => {
    test.skip(!isMobile, 'The phone is this project\'s page, and the desktop another context.');
    const { id, dir } = await conflicting(instance);
    const desktop = await browser.newContext({ baseURL: instance.url, viewport: { width: 1280, height: 800 } });
    try {
      const computer = await desktop.newPage();
      await openScreen(computer, `/repositories/${id}`);
      await clickGitAction(computer, 'Pull');
      await expect(mergeSummary(computer)).toContainText('0 of 2 files resolved');

      // The phone opens the merge and resolves the Markdown file.
      await openScreen(page, `/repositories/${id}`);
      const phone = touch(page);
      await expect(mergeSummary(page)).toContainText('0 of 2 files resolved');
      await phone.selectConflict('guide.md');
      await phone.acceptTheirs();
      await expect.poll(() => readFileSync(join(dir, 'guide.md'), 'utf8'), { timeout: 40_000 })
        .toBe(guide('theirs'));
      await phone.leaveEditor();
      await phone.press(offer(page, 'Mark as resolved'));
      await expect(mergeSummary(page)).toContainText('1 of 2 files resolved');
      await expect(mergeSummary(computer)).toContainText('1 of 2 files resolved');

      // Some time later, the desktop resolves the other and commits: nothing has expired.
      await computer.waitForTimeout(5_000);
      await expect(shownFile(computer, 'logo.png')).toBeVisible();
      await offer(computer, 'Use my version').click();
      await expect(mergeSummary(computer)).toContainText('2 of 2 files resolved');
      await expect(mergeSummary(page)).toContainText('2 of 2 files resolved');
      await commitMerge(computer, keyboardHands(computer));

      for (const tab of [ page, computer ]) {
        await expect(mergeSummary(tab)).toHaveCount(0);
        await expect(mergeNotice(tab)).toContainText(MERGE_COMMITTED);
      }
      expect(gitIn(dir, 'show', 'HEAD:guide.md')).toBe(guide('theirs'));
      expect(gitIn(dir, 'show', 'HEAD:logo.png')).toBe(png('mine'));
      expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('');
    } finally {
      await desktop.close();
    }
    drainMergeReads(monitor, id);
  });

  test('AC-GIT-003.15: the conflict list, the conflict bar and the buttons work with the keyboard alone and by touch alone, and axe-core reports no violations', async ({ page, instance, isMobile, monitor }) => {
    test.slow();
    const hands = isMobile ? touch(page) : keyboard(page);
    await confirmCommitAuthor(instance.url);
    // Two conflicts in guide.md, far enough apart for git to keep them apart.
    const text = (first: string, second: string) => `# Guide\n\n${first}\n\na\nb\nc\nd\n\n${second}\n`;
    const { id, dir, bare } = cloned(instance, { 'guide.md': text('one', 'two'), 'logo.png': png('before') });
    commitHere(dir, { 'guide.md': text('my one', 'my two'), 'logo.png': png('mine') }, 'mine');
    pushFromElsewhere(bare, 'main', [ { 'guide.md': text('their one', 'their two'), 'logo.png': png('theirs') } ]);
    const announcements = await recordAnnouncements(page);
    await openScreen(page, `/repositories/${id}`);
    await hands.gitAction('Pull');
    await expect(mergeSummary(page)).toContainText('0 of 2 files resolved');
    await axeBothSchemes(page, 'rs-repository-bar');

    // The abort question, cancelled.
    await hands.gitAction('Abort merge');
    const abort = dialog(page, 'Abort the merge?');
    await expect(abort).toBeVisible();
    await axeBothSchemes(page, 'rs-abort-merge');
    await hands.press(abort.getByRole('button', { name: 'Cancel', exact: true }));
    await expect(abort).toHaveCount(0);

    // The conflict list.
    await hands.showConflicts();
    await axeBothSchemes(page, 'rs-conflict-list');
    await hands.selectConflict('guide.md');

    // The conflict bar: each move is announced with its parts, mine and theirs (GC-28).
    const editor = editorOf(page, 'guide.md');
    await expect(editor.locator('.cm-conflict-label')).toHaveText([
      'Mine (main)',
      'Theirs (origin/main)',
      'Mine (main)',
      'Theirs (origin/main)'
    ]);
    await axeBothSchemes(page, 'rs-conflict-file');
    const barButton = (name: string) => conflictBar(page).getByRole('button', { name, exact: true });
    // Each move waits for its announcement: the announcer drops one that the next replaces within 100 ms.
    const moved = (said: string[]) => said.filter(text => text.startsWith('Conflict '));
    await hands.press(barButton('Next'));
    await expect(conflictBar(page)).toContainText('Conflict 1 of 2');
    await expect.poll(async () => moved(await announcements())).toEqual([ 'Conflict 1 of 2: mine and theirs' ]);
    await hands.press(barButton('Next'));
    await expect(conflictBar(page)).toContainText('Conflict 2 of 2');
    await expect.poll(async () => moved(await announcements())).toEqual([
      'Conflict 1 of 2: mine and theirs',
      'Conflict 2 of 2: mine and theirs'
    ]);
    await hands.press(barButton('Previous'));
    await expect(conflictBar(page)).toContainText('Conflict 1 of 2');
    await expect.poll(async () => moved(await announcements())).toEqual([
      'Conflict 1 of 2: mine and theirs',
      'Conflict 2 of 2: mine and theirs',
      'Conflict 1 of 2: mine and theirs'
    ]);
    await hands.press(barButton('Accept mine'));
    await expect(editor).toContainText('my one');
    await expect(editor.locator('.cm-conflict-label')).toHaveCount(2);

    // Mark as resolved with a marker left asks first.
    await hands.leaveEditor();
    await hands.press(offer(page, 'Mark as resolved'));
    const question = dialog(page, 'Mark as resolved?');
    await expect(question).toBeVisible();
    await axeBothSchemes(page, 'rs-markers-left');
    await hands.press(question.getByRole('button', { name: 'Cancel', exact: true }));
    await expect(question).toHaveCount(0);

    // The last conflict, from the end of the file, then the file is resolved.
    await hands.typeInto(editor, '');
    await hands.press(barButton('Previous'));
    await expect(conflictBar(page)).toContainText('Conflict 1 of 1');
    await hands.press(barButton('Accept theirs'));
    await expect(conflictBar(page)).toContainText('No conflict markers left.');
    await expect.poll(() => readFileSync(join(dir, 'guide.md'), 'utf8'), { timeout: 40_000 })
      .toBe(text('my one', 'their two'));
    await hands.leaveEditor();
    await hands.press(offer(page, 'Mark as resolved'));
    await expect(mergeSummary(page)).toContainText('1 of 2 files resolved');

    // The PNG, and the start-over question of a resolved file.
    await expect(shownFile(page, 'logo.png')).toBeVisible();
    await axeBothSchemes(page, 'rs-conflict-file');
    await hands.press(offer(page, 'Use their version'));
    await expect(mergeSummary(page)).toContainText('2 of 2 files resolved');
    await hands.selectConflict('guide.md');
    await hands.press(offer(page, 'Start over'));
    const startOver = dialog(page, 'Start over?');
    await expect(startOver).toBeVisible();
    await axeBothSchemes(page, 'rs-start-over');
    await hands.press(startOver.getByRole('button', { name: 'Cancel', exact: true }));
    await expect(startOver).toHaveCount(0);

    // The commit dialog, and the notice with its undo question.
    await hands.gitAction('Commit merge');
    const commit = dialog(page, 'Commit merge');
    await expect(commit.getByRole('textbox', { name: 'Commit message' })).toBeFocused();
    await axeBothSchemes(page, 'rs-commit-merge');
    await hands.press(commit.getByRole('button', { name: 'Commit merge', exact: true }));
    await expect(mergeNotice(page)).toContainText(MERGE_COMMITTED);
    await axeBothSchemes(page, 'rs-merge-committed');
    await hands.press(mergeNotice(page).getByRole('button', { name: 'Undo merge', exact: true }));
    const undo = dialog(page, 'Undo the merge?');
    await expect(undo).toBeVisible();
    await axeBothSchemes(page, 'rs-undo-merge');
    await hands.press(undo.getByRole('button', { name: 'Cancel', exact: true }));
    await expect(undo).toHaveCount(0);
    await expect(mergeNotice(page)).toBeVisible();
    drainMergeReads(monitor, id);
    // The backend's answer that markers are left, which asked the question.
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/merge/resolve`);
  });

  test('a reload at each step keeps the merge', async ({ page, instance, isMobile, monitor }) => {
    const { id, dir } = await conflicting(instance);
    const hands = isMobile ? touch(page) : keyboard(page);
    const reloaded = async (resolved: string) => {
      await page.reload();
      await expect(mergeSummary(page)).toContainText(resolved);
    };
    await openScreen(page, `/repositories/${id}/files/guide.md`);
    await clickGitAction(page, 'Pull');
    await expect(mergeSummary(page)).toContainText('0 of 2 files resolved');

    // The pull: the list, and the open file with its markers.
    await reloaded('0 of 2 files resolved');
    await hands.showConflicts();
    await expect(conflictList(page).getByRole('listitem')).toHaveCount(2);
    await hands.selectConflict('guide.md');
    await expect(editorOf(page, 'guide.md')).toContainText('<<<<<<< main');

    // A saved edit.
    await widget(page, 'Accept theirs').click();
    await expect.poll(() => readFileSync(join(dir, 'guide.md'), 'utf8'), { timeout: 40_000 }).toBe(guide('theirs'));
    await reloaded('0 of 2 files resolved');
    await expect(shownFile(page, 'guide.md')).toBeVisible();
    await expect(editorOf(page, 'guide.md')).not.toContainText('<<<<<<<');
    await expect(editorOf(page, 'guide.md')).toContainText('theirs');

    // A resolved file.
    await hands.leaveEditor();
    await offer(page, 'Mark as resolved').click();
    await expect(mergeSummary(page)).toContainText('1 of 2 files resolved');
    await reloaded('1 of 2 files resolved');
    await hands.showConflicts();
    await expect(conflictEntry(page, 'guide.md')).toContainText('Resolved');
    await expect(conflictEntry(page, 'logo.png')).toContainText('Unresolved');

    // Every file resolved.
    await hands.selectConflict('logo.png');
    await offer(page, 'Use my version').click();
    await expect(mergeSummary(page)).toContainText('2 of 2 files resolved');
    await reloaded('2 of 2 files resolved');
    expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe(guide('theirs'));
    expect(readFileSync(join(dir, 'logo.png'), 'utf8')).toBe(png('mine'));

    // Committed: the notice is still there, with Undo merge.
    await commitMerge(page, hands);
    await page.reload();
    await expect(mergeNotice(page)).toContainText(MERGE_COMMITTED);
    await expect(mergeNotice(page).getByRole('button', { name: 'Undo merge', exact: true })).toBeVisible();
    await expect(summary(page)).toHaveText(/main\s*·\s*2 to push/);
    drainMergeReads(monitor, id);
  });
});
