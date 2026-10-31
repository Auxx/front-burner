import AxeBuilder from '@axe-core/playwright';
import { workspaceRoot } from '@nx/devkit';
import type { Locator, Page, Request } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { drainFailedRequests, expect, type Monitor, test } from './support/fixtures';
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
function seedHandbook(dataDir: string, files: Record<string, string | Buffer> = {}): { id: number; dir: string; } {
  const [ id ] = seed(dataDir, {
    repositories: [ { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' } ]
  }).repositoryIds;
  const dir = join(dataDir, 'repos', String(ADMIN_ID), String(id));
  for (const [ path, content ] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
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
 * Answers every image the browser loads by address with a pixel, so that
 * the test needs no network: remote ones, which `img-src` allows, once
 * **Show remote images** sets their address. Repository images come through
 * the API as `blob:` URLs, and the web client's own images are served as
 * they are.
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

/** A file of headings and paragraphs, one line each, long enough to scroll both panes. */
const SECTIONS = Array.from({ length: 120 }, (_, index) => `## Section ${index + 1}\n\nText ${index + 1} of the file.`)
  .join('\n\n') + '\n';
const SECTION_LINES = SECTIONS.split('\n');

/** The line of `SECTIONS` at the top of the editor: the first visible line with text. */
async function editorTopLine(page: Page): Promise<number> {
  const text = await main(page).locator('.cm-scroller').evaluate(scroller => {
    const top = scroller.getBoundingClientRect().top;
    const lines = Array.from(scroller.querySelectorAll('.cm-line'));
    return lines.find(line => line.getBoundingClientRect().bottom > top + 1 && line.textContent)?.textContent ?? '';
  });
  return SECTION_LINES.indexOf(text) + 1;
}

/** The first line of the block at the top of the preview. */
async function previewTopLine(page: Page): Promise<number> {
  return main(page).locator('md-preview .blocks').evaluate(blocks => {
    const top = blocks.getBoundingClientRect().top;
    const block = Array.from(blocks.children).find(child => child.getBoundingClientRect().bottom > top + 1);
    return Number(block?.getAttribute('data-from-line') ?? 0);
  });
}

/** Scrolls an element of the main region as a script would; for phones, where Playwright has no wheel. */
async function scrollTo(page: Page, selector: string, top: number): Promise<void> {
  await main(page).locator(selector).evaluate((element, value) => {
    element.scrollTop = value;
  }, top);
}

test.describe('view modes', () => {
  const view = (page: Page) => main(page).getByRole('radiogroup', { name: 'View' });
  const tab = (page: Page, name: string) =>
    main(page).getByRole('tablist', { name: 'View' }).getByRole('tab', { name });

  test('AC-EDIT-001.20: scrolls the preview with the editor and back in Split, and shows one pane in Edit and Preview', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'Split is for wide screens.');
    const { id } = seedHandbook(instance.dataDir, { 'sections.md': SECTIONS });
    await openScreen(page, `/repositories/${id}/files/sections.md`);
    await expect(preview(page, 'sections.md').getByRole('heading', { name: 'Section 120' })).toBeAttached();
    await expect(view(page).getByRole('radio', { name: 'Split' })).toBeChecked();

    await editor(page, 'sections.md').hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(async () => (await editorTopLine(page)) > 20).toBe(true);
    await expect.poll(async () => Math.abs((await previewTopLine(page)) - (await editorTopLine(page))))
      .toBeLessThanOrEqual(2);

    const editorTop = await editorTopLine(page);
    await preview(page, 'sections.md').hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => editorTopLine(page)).toBeGreaterThan(editorTop + 10);
    await expect.poll(async () => Math.abs((await editorTopLine(page)) - (await previewTopLine(page))))
      .toBeLessThanOrEqual(2);

    await view(page).getByText('Edit', { exact: true }).click();
    await expect(editor(page, 'sections.md')).toBeVisible();
    await expect(preview(page, 'sections.md')).toBeHidden();

    await view(page).getByText('Preview', { exact: true }).click();
    await expect(preview(page, 'sections.md')).toBeVisible();
    await expect(editor(page, 'sections.md')).toBeHidden();
  });

  test('AC-EDIT-001.21: switches Edit and Preview tabs on a phone, keeping the place, with the cursor above the on-screen keyboard', async ({ page, instance, isMobile, browserName }) => {
    test.skip(!isMobile, 'The tabs are for narrow screens.');
    const { id } = seedHandbook(instance.dataDir, { 'sections.md': SECTIONS });
    await openScreen(page, `/repositories/${id}/files/sections.md`);
    await expect(tab(page, 'Edit')).toHaveAttribute('aria-selected', 'true');
    await expect(preview(page, 'sections.md')).toHaveCount(0);

    await scrollTo(page, '.cm-scroller', 2000);
    await expect.poll(() => editorTopLine(page)).toBeGreaterThan(20);
    const editorTop = await editorTopLine(page);
    await tab(page, 'Preview').click();
    await expect(preview(page, 'sections.md')).toBeVisible();
    await expect(editor(page, 'sections.md')).toBeHidden();
    await expect.poll(async () => Math.abs((await previewTopLine(page)) - editorTop)).toBeLessThanOrEqual(2);

    await scrollTo(page, 'md-preview .blocks', 4000);
    await expect.poll(() => previewTopLine(page)).toBeGreaterThan(editorTop + 10);
    const previewTop = await previewTopLine(page);
    await tab(page, 'Edit').click();
    await expect(editor(page, 'sections.md')).toBeVisible();
    await expect.poll(async () => Math.abs((await editorTopLine(page)) - previewTop)).toBeLessThanOrEqual(2);

    test.skip(browserName !== 'chromium', 'Shrinking the visual viewport as the keyboard does needs Chromium.');
    const line = editor(page, 'sections.md').locator('.cm-line').filter({ hasText: /^Text \d+ of the file\.$/ }).last();
    await line.click();
    const size = page.viewportSize() ?? { width: 412, height: 839 };
    await page.setViewportSize({ width: size.width, height: Math.round(size.height / 2) });
    // CodeMirror draws the cursor in a layer beside the text, not inside it.
    await expect(main(page).locator('.cm-cursor-primary')).toBeInViewport();
  });

  test('remembers the wide screen\'s mode after a reload', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'Phones have their own mode.');
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await view(page).getByText('Preview', { exact: true }).click();
    await expect(editor(page, 'README.md')).toBeHidden();

    await page.reload();

    await expect(preview(page, 'README.md').getByRole('heading', { name: 'Handbook' })).toBeVisible();
    await expect(editor(page, 'README.md')).toBeHidden();
    await expect(view(page).getByRole('radio', { name: 'Preview' })).toBeChecked();
  });

  test('remembers the phone\'s mode after a reload', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'Wide screens have their own mode.');
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await tab(page, 'Preview').click();
    await expect(preview(page, 'README.md')).toBeVisible();

    await page.reload();

    await expect(preview(page, 'README.md').getByRole('heading', { name: 'Handbook' })).toBeVisible();
    await expect(editor(page, 'README.md')).toBeHidden();
    await expect(tab(page, 'Preview')).toHaveAttribute('aria-selected', 'true');
  });

  test('AC-EDIT-001.24: has no axe violations in the view mode controls', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await expect(main(page).locator('rs-view-mode-switch')).toBeVisible();

    const results = await new AxeBuilder({ page }).include('rs-view-mode-switch').analyze();

    expect(results.violations).toEqual([]);
  });
});

/** A file of every block GitHub styles, for the preview's layout. */
const LAYOUT = [
  '# Layout',
  '',
  'First paragraph.',
  '',
  'Second paragraph.',
  '',
  '## Lists',
  '',
  'Some `inline code` in a paragraph.',
  '',
  '- one',
  '  - nested',
  '    - deeper',
  '- two',
  '',
  '- [x] done',
  '- [ ] to do',
  '',
  '> A quote.',
  '',
  '```ts',
  `const line = '${'long '.repeat(80)}';`,
  '```',
  '',
  '| A | B |',
  '| - | - |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  '---',
  '',
  'The end.',
  ''
].join('\n');

test.describe('preview', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'These check the preview beside the editor, on wide screens.');
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
    // The corpus's one repository image, so that loading it logs no failed request.
    const { id } = seedHandbook(instance.dataDir, { 'xss.md': corpus, 'a.png': PNG });
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

  test('lays out Markdown like GitHub', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir, { 'layout.md': LAYOUT });
    await openScreen(page, `/repositories/${id}/files/layout.md`);
    const view = preview(page, 'layout.md');
    await expect(view.locator('hr')).toBeAttached();

    const style = (selector: string, property: string) =>
      view.locator(selector).first().evaluate(
        (element, name) => getComputedStyle(element).getPropertyValue(name),
        property
      );
    const box = async (selector: string) => {
      const found = await view.locator(selector).first().boundingBox();
      expect(found).not.toBeNull();
      return found ?? { x: 0, y: 0, width: 0, height: 0 };
    };
    const gap = async (above: string, below: string) => {
      const [ top, bottom ] = await Promise.all([ box(above), box(below) ]);
      return Math.round(bottom.y - (top.y + top.height));
    };

    expect(await style('h2', 'border-bottom-style')).toBe('solid');
    expect(await style('h2', 'font-weight')).toBe('600');
    expect(await style('p code', 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await style('pre', 'padding-top')).toBe('16px');
    expect(await style('pre code', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await style('blockquote', 'border-left-style')).toBe('solid');
    expect(await style('.contains-task-list', 'list-style-type')).toBe('none');
    expect(await style('ul ul', 'margin-top')).toBe('0px');

    // A heading as the first block starts at the top of the preview.
    const [ blocks, first ] = await Promise.all([ box('.blocks'), box('h1') ]);
    expect(Math.round(first.y - blocks.y)).toBe(16);

    // Margins between blocks collapse as between GitHub's elements.
    expect(await gap('p:text-is("First paragraph.")', 'p:text-is("Second paragraph.")')).toBe(16);
    expect(await gap('p:text-is("Second paragraph.")', 'h2')).toBe(24);

    // ED-33: the long code line scrolls inside its block, not the preview.
    expect(await view.locator('pre').first().evaluate(pre => pre.scrollWidth > pre.clientWidth)).toBe(true);
    expect(await view.locator('.blocks').evaluate(blocks => blocks.scrollWidth === blocks.clientWidth)).toBe(true);
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

/** A PNG of `width` × `height` transparent pixels, so that a test can tell images apart by their size. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([ Buffer.from(type, 'ascii'), data ]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([ length, body, crc ]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8 bits per channel, RGBA.
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  // Each row starts with its filter type, 0.
  const rows = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const IMAGE_ENDPOINT = /\/api\/v1\/repositories\/\d+\/image$/;

/** The requests of the image endpoint, as the browser sends them. */
function imageRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', request => {
    if (IMAGE_ENDPOINT.test(new URL(request.url()).pathname)) {
      requests.push(request);
    }
  });
  return requests;
}

/** Waits until no request of `requests` has started for a while and none is in flight. */
async function settled(requests: readonly Request[], inFlight: () => number): Promise<void> {
  await expect.poll(async () => {
    const before = requests.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    return requests.length === before && inFlight() === 0;
  }).toBe(true);
}

const requestedPaths = (requests: readonly Request[]) =>
  requests.map(request => new URL(request.url()).searchParams.get('path'));

/** The width the browser decoded an image at: 0 while it has not loaded. */
const naturalWidth = (image: Locator) => image.evaluate(img => (img as HTMLImageElement).naturalWidth);

/** Expects `image` to be shown through a `blob:` URL, decoded at `width` pixels. */
async function expectBlobImage(image: Locator, width = 1): Promise<void> {
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => naturalWidth(image)).toBe(width);
}

/** Opens the screen at `url` with its preview shown: on narrow screens, on the **Preview** tab. */
async function openPreview(page: Page, url: string, isMobile: boolean): Promise<void> {
  await openScreen(page, url);
  if (isMobile) {
    await main(page).getByRole('tablist', { name: 'View' }).getByRole('tab', { name: 'Preview' }).click();
  }
}

/** Removes the console errors of image requests the test expects to fail. */
function drainFailedImages(monitor: Monitor, repositoryId: number): void {
  drainFailedRequests(monitor, `/api/v1/repositories/${repositoryId}/image`);
}

test.describe('images', () => {
  test('AC-EDIT-003.1, AC-EDIT-003.2, AC-EDIT-003.3, AC-EDIT-003.4 and AC-EDIT-003.5: shows repository images by relative, parent and root paths, decoded, at their width, uncommitted too, through blob: URLs with the token in a header', async ({ page, instance, isMobile }) => {
    // Written after the clone, so none of them is committed (AC-EDIT-003.3).
    const { id } = seedHandbook(instance.dataDir, {
      'docs/guide.md': [
        '# Guide',
        '',
        '![Diagram](img/flow.png)',
        '',
        '![Logo](../logo.svg)',
        '',
        '![Cover](/images/cover.png)',
        '',
        '<img src="img/flow.png" width="200" alt="Wide">',
        '',
        '![Photo](my%20photo.png)',
        '',
        '![Versioned](img.png?v=2)',
        ''
      ].join('\n'),
      'docs/img/flow.png': png(4, 2),
      'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><rect width="6" height="6"/></svg>',
      'images/cover.png': png(5, 1),
      'docs/my photo.png': png(7, 1),
      'docs/img.png': png(8, 1)
    });
    const requests = imageRequests(page);
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);
    const view = preview(page, 'guide.md');

    await expectBlobImage(view.getByRole('img', { name: 'Diagram', exact: true }), 4);
    await expectBlobImage(view.getByRole('img', { name: 'Logo', exact: true }), 6);
    await expectBlobImage(view.getByRole('img', { name: 'Cover', exact: true }), 5);
    await expectBlobImage(view.getByRole('img', { name: 'Photo', exact: true }), 7);
    await expectBlobImage(view.getByRole('img', { name: 'Versioned', exact: true }), 8);
    const wide = view.getByRole('img', { name: 'Wide', exact: true });
    await expectBlobImage(wide, 4);
    expect((await wide.boundingBox())?.width).toBe(200);

    // AC-EDIT-003.4
    expect(requestedPaths(requests).sort()).toEqual([
      'docs/img.png',
      'docs/img/flow.png',
      'docs/my photo.png',
      'images/cover.png',
      'logo.svg'
    ]);
    for (const request of requests) {
      expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    }
    const token = (await requests[0]?.headerValue('authorization'))?.replace('Bearer ', '') ?? '';
    const addresses = await view.locator('img').evaluateAll(images => images.map(img => img.getAttribute('src') ?? ''));
    expect(addresses).toHaveLength(6);
    for (const address of [ ...addresses, ...requests.map(request => request.url()) ]) {
      expect(address).not.toContain(token);
    }
    expect(addresses.every(address => address.startsWith('blob:'))).toBe(true);
  });

  test('AC-EDIT-003.6: refuses images outside the repository, in .git and through a symbolic link', async ({ page, instance, monitor, isMobile }) => {
    const { id, dir } = seedHandbook(instance.dataDir, {
      'docs/guide.md': '# Guide\n\n![Passwd](../../../../etc/passwd)\n\n![Config](.git/config)\n\n![Link](link.png)\n'
    });
    writeFileSync(join(instance.dataDir, 'outside.png'), PNG);
    symlinkSync(join(instance.dataDir, 'outside.png'), join(dir, 'docs/link.png'));
    const requests = imageRequests(page);
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);
    const view = preview(page, 'guide.md');

    for (const alt of [ 'Passwd', 'Config', 'Link' ]) {
      await expect(view.getByRole('img', { name: `${alt}, Can't show this image`, exact: true })).toBeVisible();
    }
    // The first two are refused without a request; the backend refuses the link.
    expect(requestedPaths(requests)).toEqual([ 'docs/link.png' ]);
    const authorization = (await requests[0]?.headerValue('authorization')) ?? '';
    for (const path of [ '../../../etc/passwd', '.git/config', 'docs/link.png' ]) {
      const response = await page.request.get(`/api/v1/repositories/${id}/image`, {
        params: { path },
        headers: { authorization }
      });
      expect(response.status(), path).toBe(400);
    }
    drainFailedImages(monitor, id);
  });

  test('AC-EDIT-003.7: shows why a missing, too large or unsupported image isn\'t shown, with its alt text', async ({ page, instance, monitor, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'docs/guide.md': '# Guide\n\n![Flow](img/missing.png)\n\n![Big](big.png)\n\n![Scan](scan.tiff)\n',
      // Only its size matters: the endpoint refuses it before reading it.
      'docs/big.png': Buffer.concat([ PNG, Buffer.alloc(12 * 1024 * 1024) ]),
      'docs/scan.tiff': 'II*\0'
    });
    const requests = imageRequests(page);
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);
    const view = preview(page, 'guide.md');

    await expect(view.getByRole('img', { name: 'Flow, Image not found: img/missing.png', exact: true })).toBeVisible();
    await expect(view.getByRole('img', { name: 'Big, This image is too large to preview', exact: true }))
      .toBeVisible();
    await expect(view.getByRole('img', { name: 'Scan, This image format isn\'t supported', exact: true }))
      .toBeVisible();
    await expect(view.getByText('Image not found: img/missing.png')).toBeVisible();
    expect(requestedPaths(requests).sort()).toEqual([ 'docs/big.png', 'docs/img/missing.png' ]);
    drainFailedImages(monitor, id);
  });

  test('AC-EDIT-003.8: loads only nearby images, four at a time, and none again while typing or switching files', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'Typing while the preview shows needs Split.');
    const images = Array.from({ length: 200 }, (_, index) => index + 1);
    const { id } = seedHandbook(instance.dataDir, {
      'many.md': [
        '# Many',
        '',
        'Intro',
        '',
        '[Other](other.md)',
        '',
        ...images.map(index => `<img src="img/${index}.png" width="40" height="40" alt="Image ${index}">\n`)
      ].join('\n'),
      'other.md': '# Other\n\n[Back](many.md)\n',
      ...Object.fromEntries(images.map(index => [ `img/${index}.png`, png(index, 1) ]))
    });
    // Counts the requests in flight, delayed so that more would overlap if the limit failed.
    let inFlight = 0;
    let mostInFlight = 0;
    await page.route(url => IMAGE_ENDPOINT.test(url.pathname), async route => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 50));
      inFlight--;
      await route.fulfill({ response });
    });
    const loads: string[] = [];
    page.on('response', response => {
      if (IMAGE_ENDPOINT.test(new URL(response.url()).pathname) && response.status() === 200) {
        loads.push(new URL(response.url()).searchParams.get('path') ?? '');
      }
    });
    const requests = imageRequests(page);
    await openPreview(page, `/repositories/${id}/files/many.md`, isMobile);
    const view = preview(page, 'many.md');
    await expectBlobImage(view.getByRole('img', { name: 'Image 1', exact: true }), 1);
    await expect.poll(() => requests.length).toBeGreaterThan(4);
    await settled(requests, () => inFlight);

    expect(loads.length).toBeLessThan(60);
    expect(loads).not.toContain('img/200.png');
    expect(mostInFlight).toBeLessThanOrEqual(4);
    const loaded = loads.length;
    const requested = requests.length;

    await editor(page, 'many.md').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.type(' more');
    await expect(view.getByText('Intro more')).toBeVisible();
    await expect(status(page)).toHaveText('Saved');
    await settled(requests, () => inFlight);
    expect(requests.length).toBe(requested);

    await view.getByRole('link', { name: 'Other' }).click();
    await preview(page, 'other.md').getByRole('link', { name: 'Back' }).click();
    await expectBlobImage(preview(page, 'many.md').getByRole('img', { name: 'Image 1', exact: true }), 1);
    await settled(requests, () => inFlight);
    // Revalidated with `If-None-Match` at most, never loaded again.
    expect(loads.length).toBe(loaded);
  });

  test('AC-EDIT-003.9: shows an image replaced on disk without a reload', async ({ page, instance, isMobile }) => {
    const { id, dir } = seedHandbook(instance.dataDir, {
      'docs/guide.md': '# Guide\n\n![Flow](img/flow.png)\n',
      'docs/img/flow.png': png(1, 1)
    });
    const requests = imageRequests(page);
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);
    const image = preview(page, 'guide.md').getByRole('img', { name: 'Flow', exact: true });
    await expectBlobImage(image, 1);

    writeFileSync(join(dir, 'docs/img/flow.png'), png(3, 2));
    // A pull would name the folder in `files.changed`; creating a file there does too (the pull comes with step 4).
    const response = await page.request.post(`/api/v1/repositories/${id}/entries`, {
      headers: { authorization: (await requests[0]?.headerValue('authorization')) ?? '' },
      data: { folder: 'docs/img', name: 'notes.md', kind: 'file' }
    });
    expect(response.ok()).toBe(true);

    await expect.poll(() => naturalWidth(image)).toBe(3);
    await expect(image).toHaveAttribute('src', /^blob:/);
  });

  test('AC-EDIT-003.10: shows the dark or the light picture by colour scheme, and switches', async ({ page, instance, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'brand.md': '# Brand\n\n<picture><source media="(prefers-color-scheme: dark)" srcset="logo-dark.png">'
        + '<img src="logo-light.png" alt="Brand"></picture>\n',
      'logo-dark.png': png(3, 1),
      'logo-light.png': png(2, 1)
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    const requests = imageRequests(page);
    await openPreview(page, `/repositories/${id}/files/brand.md`, isMobile);
    const image = preview(page, 'brand.md').getByRole('img', { name: 'Brand', exact: true });

    await expectBlobImage(image, 3);
    expect(requestedPaths(requests)).toEqual([ 'logo-dark.png' ]);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => naturalWidth(image)).toBe(2);
    expect(requestedPaths(requests)).toEqual([ 'logo-dark.png', 'logo-light.png' ]);
  });

  test('AC-EDIT-003.11 and AC-EDIT-003.12: shows remote images only after Show remote images, with no referrer, and never http ones', async ({ page, instance, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'badges.md': [
        '# Badges',
        '',
        '![Build](https://img.shields.io/badge/build-passing-green.png)',
        '',
        '![Insecure](http://example.com/a.png)',
        '',
        '[Other](other.md)',
        ''
      ].join('\n'),
      'other.md': '# Other\n\n[Back](badges.md)\n'
    });
    const remote: Request[] = [];
    await page.route('https://img.shields.io/**', route => {
      remote.push(route.request());
      return route.fulfill({ contentType: 'image/png', body: png(9, 1) });
    });
    const insecure: string[] = [];
    page.on('request', request => {
      if (request.url().startsWith('http://example.com')) {
        insecure.push(request.url());
      }
    });
    await openPreview(page, `/repositories/${id}/files/badges.md`, isMobile);
    const view = preview(page, 'badges.md');
    const placeholder = view.getByRole('img', { name: 'Build, Remote image from img.shields.io', exact: true });

    await expect(placeholder).toBeVisible();
    await expect(view.getByText('Loading them lets these sites see your IP address.')).toBeVisible();
    expect(remote).toEqual([]);
    await view.getByRole('button', { name: 'Show remote images' }).click();

    const image = view.getByRole('img', { name: 'Build', exact: true });
    await expect.poll(() => naturalWidth(image)).toBe(9);
    await expect(image).toHaveAttribute('src', 'https://img.shields.io/badge/build-passing-green.png');
    expect(remote).toHaveLength(1);
    expect(await remote[0]?.headerValue('referer')).toBeNull();
    await expect(view.getByRole('button', { name: 'Show remote images' })).toHaveCount(0);
    // AC-EDIT-003.12
    await expect(view.getByRole('img', { name: 'Insecure, Insecure image (http) isn\'t shown', exact: true }))
      .toBeVisible();
    expect(insecure).toEqual([]);

    await view.getByRole('link', { name: 'Other' }).click();
    await preview(page, 'other.md').getByRole('link', { name: 'Back' }).click();
    await expect(
      preview(page, 'badges.md').getByRole('img', {
        name: 'Build, Remote image from img.shields.io',
        exact: true
      })
    ).toBeVisible();
    await expect(preview(page, 'badges.md').getByRole('button', { name: 'Show remote images' })).toBeVisible();
    expect(remote).toHaveLength(1);
  });

  test('AC-EDIT-003.13: shows an SVG with a script as an image and runs nothing', async ({ page, instance, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'docs/guide.md': '# Guide\n\n![Evil](evil.svg)\n',
      'docs/evil.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="window.parent.ran = true">'
        + '<script>window.parent.ran = true; alert(1)</script><rect width="10" height="10"/></svg>'
    });
    const dialogs: string[] = [];
    page.on('dialog', dialog => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);

    await expectBlobImage(preview(page, 'guide.md').getByRole('img', { name: 'Evil', exact: true }), 10);
    expect(await page.evaluate(() => (window as unknown as { ran?: boolean; }).ran)).toBeUndefined();
    expect(dialogs).toEqual([]);
  });

  test('AC-EDIT-003.14 and AC-EDIT-003.15: keeps a missing image\'s link around its placeholder, named by alt text and reason', async ({ page, instance, monitor, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'docs/guide.md': '# Guide\n\n[![Docs logo](missing.png)](https://example.com)\n'
    });
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);
    const link = preview(page, 'guide.md').getByRole('link', { name: 'Docs logo, Image not found: missing.png' });

    await expect(link).toHaveAttribute('href', 'https://example.com');
    await expect(link.getByRole('img', { name: 'Docs logo, Image not found: missing.png', exact: true }))
      .toBeVisible();
    drainFailedImages(monitor, id);
  });

  test('has no axe violations with image placeholders shown', async ({ page, instance, monitor, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'docs/guide.md': '# Guide\n\n![Flow](img/flow.png)\n\n![Missing](missing.png)\n\n![](decorative.tiff)\n\n'
        + '![Badge](https://img.shields.io/badge/a.png) ![](http://example.com/a.png)\n',
      'docs/img/flow.png': png(4, 2)
    });
    await openPreview(page, `/repositories/${id}/files/docs/guide.md`, isMobile);
    const view = preview(page, 'guide.md');
    await expectBlobImage(view.getByRole('img', { name: 'Flow', exact: true }), 4);
    await expect(view.getByRole('img', { name: 'Missing, Image not found: missing.png' })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Show remote images' })).toBeVisible();

    const results = await new AxeBuilder({ page }).include('md-preview').analyze();

    expect(results.violations).toEqual([]);
    drainFailedImages(monitor, id);
  });
});
