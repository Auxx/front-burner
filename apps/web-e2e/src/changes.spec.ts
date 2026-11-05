import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './support/fixtures';
import { confirmCommitAuthor, logIn, seed, TEST_ADMIN } from './support/instance';
import { gitIn } from './support/working-copy';

test.use({ instanceOptions: { onboarded: true } });

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

const changesButton = (page: Page, name: string | RegExp = /^Changes/) =>
  page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', { name });
const changesPane = (page: Page) => page.getByRole('region', { name: 'Changes', exact: true });
const rows = (page: Page) => changesPane(page).getByRole('listitem');
const tick = (page: Page, path: string) =>
  changesPane(page).getByRole('checkbox', { name: `Commit ${path}`, exact: true });
const message = (page: Page) => changesPane(page).getByRole('textbox', { name: 'Commit message' });
const commitButton = (page: Page, name: string) => changesPane(page).getByRole('button', { name, exact: true });

/** A repository of the handbook fixture, with the admin's commit author confirmed; returns its working copy. */
async function handbook(instance: { url: string; dataDir: string; }): Promise<{ id: number; dir: string; }> {
  await confirmCommitAuthor(instance.url);
  const [ id ] = seed(instance.dataDir, {
    repositories: [ { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' } ]
  }).repositoryIds;
  return { id, dir: join(instance.dataDir, 'repos', String(ADMIN_ID), String(id)) };
}

async function openScreen(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await logIn(page);
}

/** Shows **Changes**: beside the editor on wide screens, and a drawer on phones (GA-10). */
async function showChanges(page: Page): Promise<void> {
  if (await changesButton(page).getAttribute('aria-pressed') === 'false') {
    await changesButton(page).click();
  }
  await expect(changesPane(page)).toBeVisible();
}

test.describe('committing', () => {
  test('AC-GIT-002.4: unticking one of three files commits the two ticked files as the commit author, and the third stays in Changes', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    writeFileSync(join(dir, 'docs/guide.md'), '# Changed\n');
    writeFileSync(join(dir, 'new.md'), '# New\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (3)')).toBeVisible();
    await showChanges(page);

    await expect(commitButton(page, 'Commit 3 files')).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright waits for a button that is `aria-disabled` to be enabled, but a tap here says why.
    await commitButton(page, 'Commit 3 files').click({ force: true });
    await expect(page.locator('ui-tooltip')).toHaveText('Write a commit message first.');

    await tick(page, 'new.md').click();
    await expect(commitButton(page, 'Commit 2 files')).toBeVisible();
    await expect(changesPane(page).getByRole('checkbox', { name: 'All files' })).toHaveAttribute(
      'aria-checked',
      'mixed'
    );
    await message(page).fill('Change two files');
    expect((await new AxeBuilder({ page }).include('rs-changes-pane').analyze()).violations).toEqual([]);

    await commitButton(page, 'Commit 2 files').click();

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('new.md');
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toEqual([
      'README.md',
      'docs/guide.md'
    ]);
    const author = `${TEST_ADMIN.displayName} <${TEST_ADMIN.email}>`;
    expect(gitIn(dir, 'log', '-1', '--format=%an <%ae>|%cn <%ce>').trim()).toBe(`${author}|${author}`);
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('?? new.md');
  });

  test('AC-GIT-002.5: typing and committing at once includes the last edit', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    // A clean file, so that **Changes** does not list it until a status has been read after the save.
    await openScreen(page, `/repositories/${id}/files/README.md`);

    await page.getByRole('main', { name: 'Editor' }).getByRole('textbox', { name: 'README.md', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('The last edit');
    await showChanges(page);
    await message(page).fill('With the last edit');
    await commitButton(page, 'Commit 1 file').click();

    // The field is cleared by the commit. "No changes" may still be there from before the first edit.
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'show', 'HEAD:README.md')).toContain('The last edit');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('The last edit');
    await expect(changesPane(page).getByText('No changes since the last commit.')).toBeVisible();
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('');
  });

  test('AC-GIT-002.6: a first line over 72 characters shows a hint and still commits, and a line starting with # is kept', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await showChanges(page);
    const hint = changesPane(page).getByText('The first line is longer than 72 characters.');
    const subject = 'x'.repeat(73);

    await message(page).fill('x'.repeat(72));
    await expect(hint).toBeHidden();
    await message(page).fill(`${subject}\n\n# Kept\n  \n\n`);
    await expect(hint).toBeVisible();
    await commitButton(page, 'Commit 1 file').click();

    await expect(changesPane(page).getByText('No changes since the last commit.')).toBeVisible();
    expect(gitIn(dir, 'log', '-1', '--format=%B').trimEnd()).toBe(`${subject}\n\n# Kept`);
  });

  test('AC-GIT-002.23: an unticked file stays unticked after a reload, and a file changed later appears ticked', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    writeFileSync(join(dir, 'new.md'), '# New\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (2)')).toBeVisible();
    await showChanges(page);
    await tick(page, 'new.md').click();
    await expect(tick(page, 'new.md')).not.toBeChecked();

    writeFileSync(join(dir, 'later.md'), '# Later\n');
    await page.reload();
    await expect(changesButton(page, 'Changes (3)')).toBeVisible();
    await showChanges(page);

    await expect(tick(page, 'new.md')).not.toBeChecked();
    await expect(tick(page, 'README.md')).toBeChecked();
    await expect(tick(page, 'later.md')).toBeChecked();
  });
});
