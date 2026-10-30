import AxeBuilder from '@axe-core/playwright';
import { workspaceRoot } from '@nx/devkit';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './support/fixtures';
import { logIn, seed } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

const NOTICE = 'Some HTML isn\'t shown in the preview.';

const main = (page: Page) => page.getByRole('main', { name: 'Editor' });
const editor = (page: Page, name: string) => main(page).getByRole('textbox', { name, exact: true });
const preview = (page: Page, name: string) => main(page).getByRole('region', { name: `Preview of ${name}` });
const status = (page: Page) => page.getByRole('banner').getByRole('status');
const treeItem = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`)
  });

/** Seeds `handbook` with the files of `files` in its working copy; returns its ID and its working copy. */
function seedHandbook(dataDir: string, files: Record<string, string> = {}): { id: number; dir: string; } {
  const [ id ] = seed(dataDir, {
    repositories: [ { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' } ]
  }).repositoryIds;
  const dir = join(dataDir, 'repos', String(ADMIN_ID), String(id));
  for (const [ path, content ] of Object.entries(files)) {
    writeFileSync(join(dir, path), content);
  }
  return { id, dir };
}

/** Logs in on the way to `url` and waits for the repository to have opened. */
async function openScreen(page: Page, url: string): Promise<void> {
  const opened = page.waitForResponse(response => /\/api\/v1\/repositories\/\d+\/open$/.test(response.url()));
  await page.goto(url);
  await logIn(page);
  await opened;
}

/** Types `text` at the end of the open file `name`. */
async function typeAtEnd(page: Page, name: string, text: string): Promise<void> {
  await editor(page, name).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

/** The smallest valid PNG: one transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

/** The built web client, which the instance serves. */
const WEB_ROOT = join(workspaceRoot, 'dist/apps/web/browser');

/**
 * Answers the images of the preview with a pixel: remote ones, which
 * `img-src` allows, so that the test needs no network, and relative ones,
 * which the image loader (plan 33) does not resolve yet, so they resolve
 * against the page's `<base href="/">`. The web client's own images are
 * served as they are.
 */
async function answerImages(page: Page, origin: string): Promise<void> {
  const isBuildFile = (url: URL) =>
    url.origin === origin && existsSync(join(WEB_ROOT, decodeURIComponent(url.pathname)));
  await page.route(
    url => !isBuildFile(url),
    route =>
      route.request().resourceType() === 'image'
        ? route.fulfill({ contentType: 'image/png', body: PNG })
        : route.fallback()
  );
}

/** Paragraphs of filler, so that a heading after them is out of view. */
const filler = (count: number) =>
  Array.from({ length: count }, (_, index) => `Paragraph ${index + 1} of words that fill the preview.`).join('\n\n');

// On narrow screens the preview is not on screen while typing (A-8.12); plan 31 adds its tab.
test.describe('preview', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The preview is shown beside the editor on wide screens only.');
  });

  test('AC-EDIT-001.1: shows the preview beside the editor', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);

    await expect(editor(page, 'README.md')).toBeVisible();
    await expect(preview(page, 'README.md').getByRole('heading', { level: 1, name: 'Handbook' })).toBeVisible();
    const editorBox = await editor(page, 'README.md').boundingBox();
    const previewBox = await preview(page, 'README.md').boundingBox();
    expect(previewBox?.x).toBeGreaterThan((editorBox?.x ?? 0) + (editorBox?.width ?? 0) - 1);
  });

  test('AC-EDIT-001.14: renders GitHub Markdown, hides front matter and shows mermaid as code', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'gfm.md': [
        '---',
        'title: Hidden front matter',
        '---',
        '# Title',
        '',
        '- one',
        '- two',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '- [x] done',
        '- [ ] to do',
        '',
        '~~gone~~ and https://example.com',
        '',
        'A note[^1].',
        '',
        '[^1]: The footnote.',
        '',
        '```ts',
        'const answer = 42;',
        '```',
        '',
        '```mermaid',
        'graph TD; A-->B',
        '```',
        ''
      ].join('\n')
    });
    await openScreen(page, `/repositories/${id}/files/gfm.md`);
    const view = preview(page, 'gfm.md');

    await expect(view.getByRole('heading', { level: 1, name: 'Title' })).toBeVisible();
    await expect(view.getByText('Hidden front matter')).toHaveCount(0);
    await expect(view.getByRole('listitem').filter({ hasText: /^one$/ })).toBeVisible();
    await expect(view.getByRole('table')).toBeVisible();
    await expect(view.getByRole('checkbox')).toHaveCount(2);
    await expect(view.getByRole('checkbox').first()).toBeChecked();
    await expect(view.getByRole('checkbox').first()).toBeDisabled();
    await expect(view.locator('del')).toHaveText('gone');
    await expect(view.getByRole('link', { name: 'https://example.com' })).toBeVisible();
    await expect(view.getByText('The footnote.')).toBeVisible();
    await expect(view.locator('code.language-ts span[class^="sk-"]').first()).toBeVisible();
    await expect(view.locator('pre code').filter({ hasText: 'graph TD; A-->B' })).toBeVisible();
  });

  test('AC-EDIT-001.15: runs no script or handler from the file', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'hostile.md': [
        '# Hostile',
        '',
        '<script>window.ran = true; alert(1)</script>',
        '',
        '<img src="https://example.com/logo.png" onerror="window.ran = true" onload="window.ran = true" alt="Logo">',
        '',
        '<p onclick="window.ran = true" style="color: red">Click me</p>',
        ''
      ].join('\n')
    });
    const dialogs: string[] = [];
    page.on('dialog', dialog => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await answerImages(page, new URL(instance.url).origin);
    await openScreen(page, `/repositories/${id}/files/hostile.md`);
    const view = preview(page, 'hostile.md');

    await view.getByText('Click me').click();

    await expect(view.getByText('Click me')).toBeVisible();
    await expect(view.getByRole('img', { name: 'Logo' })).toBeVisible();
    expect(await view.locator('.blocks').locator('script, [onclick], [onerror], [onload], [style]').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { ran?: boolean; }).ran)).toBeUndefined();
    expect(dialogs).toEqual([]);
  });

  test('AC-EDIT-001.16: updates a 200 KB file\'s preview within 300 ms after typing stops', async ({ page, instance, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol.');
    // Many short blocks, as a real file has: typing re-renders only the last one (A-8.12).
    const parts = [ '# Large' ];
    let length = parts[0].length;
    for (let index = 1; length < 200 * 1024; index++) {
      const part = index % 50 === 0
        ? `## Part ${index / 50}`
        : `Paragraph ${index} of a large file, with some words to make it long enough to count.`;
      parts.push(part);
      length += part.length + 2;
    }
    const content = `${parts.join('\n\n')}\n\nThe end`;
    const { id } = seedHandbook(instance.dataDir, { 'large.md': content });
    await openScreen(page, `/repositories/${id}/files/large.md`);
    await expect(preview(page, 'large.md').getByText('The end', { exact: true })).toBeAttached();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.evaluate(() => {
      const state = window as unknown as { lastKey: number; changedAt: number | null; };
      state.changedAt = null;
      document.addEventListener('keydown', () => {
        state.lastKey = performance.now();
        state.changedAt = null;
      }, true);
      const blocks = document.querySelector('md-preview .blocks') as HTMLElement;
      new MutationObserver(() => {
        state.changedAt ??= performance.now();
      }).observe(blocks, { childList: true, subtree: true, characterData: true });
    });
    await typeAtEnd(page, 'large.md', ' more');

    const delay = await page.waitForFunction(
      () => {
        const state = window as unknown as { lastKey: number; changedAt: number | null; };
        return state.changedAt === null ? null : state.changedAt - state.lastKey;
      },
      undefined,
      { timeout: 5000 }
    );
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    expect(await delay.jsonValue()).toBeLessThan(300);
  });

  test('AC-EDIT-001.18: follows a relative, a fragment and an external link', async ({ page, context, instance }) => {
    const { id } = seedHandbook(instance.dataDir);
    writeFileSync(
      join(instance.dataDir, 'repos', String(ADMIN_ID), String(id), 'docs', 'links.md'),
      [
        '# Links',
        '',
        '[The guide](../docs/guide.md), [install](#install) and [the site](https://example.com).',
        '',
        filler(80),
        '',
        '## Install',
        '',
        'How to install.',
        ''
      ].join('\n')
    );
    await context.route('https://example.com/**', route => route.fulfill({ body: '<title>Example</title>' }));
    await openScreen(page, `/repositories/${id}/files/docs/links.md`);
    const view = preview(page, 'links.md');

    await view.getByRole('link', { name: 'install' }).click();
    await expect(view.getByRole('heading', { name: 'Install' })).toBeInViewport();
    expect(page.url()).toMatch(/\/files\/docs\/links\.md$/);

    const popup = page.waitForEvent('popup');
    await view.getByRole('link', { name: 'the site' }).click();
    expect((await popup).url()).toBe('https://example.com/');
    await expect(view.getByRole('link', { name: 'the site' })).toHaveAttribute('rel', 'noopener noreferrer');

    await view.getByRole('link', { name: 'The guide' }).click();
    await expect(editor(page, 'guide.md')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/repositories/${id}/files/docs/guide\\.md$`));
  });

  test('AC-EDIT-001.19: shows an Arabic paragraph right to left in the editor and the preview', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'arabic.md': '# Title\n\nمرحبا بكم في الدليل.\n\nAn English paragraph.\n'
    });
    await openScreen(page, `/repositories/${id}/files/arabic.md`);
    const view = preview(page, 'arabic.md');

    await expect(view.getByText('مرحبا بكم في الدليل.')).toBeVisible();
    expect(await view.getByText('مرحبا بكم في الدليل.').evaluate(element => element.matches(':dir(rtl)'))).toBe(true);
    expect(await view.getByText('An English paragraph.').evaluate(element => element.matches(':dir(ltr)'))).toBe(
      true
    );
    const line = editor(page, 'arabic.md').locator('.cm-line', { hasText: 'مرحبا' });
    expect(await line.evaluate(element => getComputedStyle(element).direction)).toBe('rtl');
  });

  test.describe('removed HTML', () => {
    test('AC-EDIT-002.13: says HTML was removed, lists it by count, and goes when it is deleted', async ({ page, instance }) => {
      const { id } = seedHandbook(instance.dataDir, {
        'embed.md':
          '# Embed\n\n<iframe src="https://example.com"></iframe>\n\n<iframe src="https://example.com/2"></iframe>\n\n'
          + '<p style="color: red">Red</p>\n',
        'comments.md': '# Comments\n\n<!-- a comment -->\n'
      });
      await openScreen(page, `/repositories/${id}/files/embed.md`);
      const view = preview(page, 'embed.md');

      await expect(view.getByText(NOTICE)).toBeVisible();
      await view.getByRole('button', { name: 'Details' }).click();
      await expect(view.getByRole('listitem')).toHaveText([ '<iframe> × 2', 'style attribute × 1' ]);
      await expect(view.getByText('example.com')).toHaveCount(0);
      await expect(view.getByText('color: red')).toHaveCount(0);

      await editor(page, 'embed.md').click();
      await page.keyboard.press('ControlOrMeta+a');
      // Deleted by CodeMirror first: typing over a selection of highlighted text makes Chrome
      // insert `style` attributes of its own, which the policy refuses.
      await page.keyboard.press('Backspace');
      await page.keyboard.type('# Embed\n\nNothing left.\n');
      await expect(view.getByText('Nothing left.')).toBeVisible();
      await expect(view.getByText(NOTICE)).toHaveCount(0);

      await treeItem(page, 'comments.md').click();
      await expect(preview(page, 'comments.md').getByRole('heading', { name: 'Comments' })).toBeVisible();
      await expect(page.getByText(NOTICE)).toHaveCount(0);
    });

    test('AC-EDIT-002.14: Hide hides the notice until the file is opened again', async ({ page, instance }) => {
      const { id } = seedHandbook(instance.dataDir, { 'embed.md': '# Embed\n\n<iframe></iframe>\n' });
      await openScreen(page, `/repositories/${id}/files/embed.md`);
      const view = preview(page, 'embed.md');

      await view.getByRole('button', { name: 'Hide' }).click();
      await expect(view.getByText(NOTICE)).toHaveCount(0);
      await typeAtEnd(page, 'embed.md', '\nMore text <iframe></iframe>\n');
      await expect(view.getByText('More text')).toBeVisible();
      await expect(view.getByText(NOTICE)).toHaveCount(0);

      await treeItem(page, 'README.md').click();
      await expect(preview(page, 'README.md')).toBeVisible();
      await page.goBack();

      await expect(preview(page, 'embed.md').getByText(NOTICE)).toBeVisible();
    });

    test('AC-EDIT-002.15: shows removed tags in the editor and saves the file unchanged', async ({ page, instance }) => {
      const content = '# Embed\n\n<iframe src="https://example.com"></iframe>\n';
      const { id, dir } = seedHandbook(instance.dataDir, { 'embed.md': content });
      await openScreen(page, `/repositories/${id}/files/embed.md`);

      await expect(editor(page, 'embed.md')).toContainText('<iframe src="https://example.com"></iframe>');
      await typeAtEnd(page, 'embed.md', 'x');
      await expect(status(page)).toHaveText('Saved');
      await page.keyboard.press('Backspace');
      await expect.poll(() => readFileSync(join(dir, 'embed.md'), 'utf8')).toBe(content);
    });
  });

  test('AC-EDIT-002.16: renders the XSS corpus with no CSP violation', async ({ page, instance }) => {
    const corpus = readFileSync(join(workspaceRoot, 'apps/web-e2e/src/support/fixtures/xss-corpus.md'), 'utf8');
    const { id } = seedHandbook(instance.dataDir, { 'xss.md': corpus });
    const dialogs: string[] = [];
    page.on('dialog', dialog => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await answerImages(page, new URL(instance.url).origin);
    await openScreen(page, `/repositories/${id}/files/xss.md`);
    const view = preview(page, 'xss.md');

    await expect(view.getByRole('heading', { name: 'XSS corpus', exact: true })).toBeVisible();
    await expect(view.getByText(NOTICE)).toBeVisible();
    // Scrolls through the whole preview, so that every block is laid out.
    await view.locator('.blocks').evaluate(async blocks => {
      for (let top = 0; top < blocks.scrollHeight; top += blocks.clientHeight) {
        blocks.scrollTop = top;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    });

    expect(dialogs).toEqual([]);
    expect(
      await page.evaluate(() =>
        document.querySelectorAll('md-preview .blocks script, md-preview .blocks [style]').length
      )
    ).toBe(0);
    // The fixture fails the test on any `securitypolicyviolation` or console error.
  });

  test('AC-EDIT-001.24: has no axe violations in the preview', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'rich.md': '# Rich\n\n## Section\n\n- a list\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n'
        + '```ts\nconst x = 1;\n```\n\n[a link](https://example.com)\n\n<iframe></iframe>\n'
    });
    await openScreen(page, `/repositories/${id}/files/rich.md`);
    const view = preview(page, 'rich.md');
    await expect(view.getByRole('heading', { name: 'Section' })).toBeVisible();
    await view.getByRole('button', { name: 'Details' }).click();

    const results = await new AxeBuilder({ page }).include('md-preview').analyze();

    expect(results.violations).toEqual([]);
  });
});
