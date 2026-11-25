import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drainFailedRequests, expect, test, WEBKIT_SECURE_COOKIES } from './support/fixtures';
import { logIn, seed, TEST_ADMIN } from './support/instance';
import { ADMIN_ID, workingCopyOf } from './support/repositories';

// The login page is reachable once onboarding is completed (AO-3).
test.use({ instanceOptions: { onboarded: true } });

const REFRESH_COOKIE = 'front_burner_refresh';
const SHORT_TOKENS = { onboarded: true, env: { FRONT_BURNER_AUTH_TOKEN_TTL: '2s' } };

const loginHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Log in', exact: true });
const dashboardHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true });

async function refreshCookie(context: BrowserContext) {
  return (await context.cookies()).find(cookie => cookie.name === REFRESH_COOKIE);
}

test.describe('login page', () => {
  test('AC-AUTH-003.1: opens without a login', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    await expect(page).toHaveTitle('Log in · Front Burner');
    await expect(page.getByRole('banner')).toHaveCount(0);
  });

  test('logs in and goes to the page asked for, with the refresh token in a cookie', async ({ page, context, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_SECURE_COOKIES);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
    await expect(loginHeading(page)).toBeVisible();

    const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login');
    await logIn(page);
    const body = await (await login).json() as Record<string, unknown>;

    await expect(page).toHaveURL(/\/$/);
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(page).toHaveTitle('Dashboard · Front Burner');
    expect(body['authToken']).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('refreshToken');
    expect(await refreshCookie(context)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  });

  test('accepts the email in another letter case', async ({ page }) => {
    await page.goto('/login');
    await logIn(page, TEST_ADMIN.email.toUpperCase());
    await expect(dashboardHeading(page)).toBeVisible();
  });

  test('says "Wrong username or password" and clears the password', async ({ page, monitor }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(TEST_ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Wrong username or password')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
    drainFailedRequests(monitor, '/api/v1/auth/login');
  });

  test('asks for a login again after Log out', async ({ page }) => {
    await page.goto('/login');
    await logIn(page);
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();

    await expect(loginHeading(page)).toBeVisible();
    await expect(page.getByText('You have been logged out')).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
    await expect(page.getByText('You have been logged out')).toHaveCount(0);
  });

  test('does not warn about HTTPS on localhost', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    await expect(page.getByText('This instance is not served over HTTPS.', { exact: false })).toHaveCount(0);
  });

  test('NF-13.8: has no accessibility violations', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('NF-11.1: index.html, a deep link and an error page carry the exact CSP', async ({ page }) => {
    // NF-11.1's text, word for word; only the nonce differs per response.
    const policy = new RegExp(
      '^' + [
        `default-src 'none'`,
        `script-src 'self'`,
        `style-src 'self' 'nonce-([A-Za-z0-9+/]{22}==)'`,
        `img-src 'self' blob: data: https:`,
        `connect-src 'self'`,
        `font-src 'self'`,
        `manifest-src 'self'`,
        `worker-src 'self'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        `frame-ancestors 'none'`,
        `object-src 'none'`,
        `require-trusted-types-for 'script'`
      ].join('; ') + '$'
    );
    const nonces: string[] = [];
    // The root, a deep link into a repository, and a route that shows the "page not found" page; the root twice.
    for (const path of [ '/', '/', '/repositories/1/files/docs/guide.md', '/no-such-page' ]) {
      // As the browser asks for a page; the client's routing after it is not what is checked.
      const response = await page.request.get(path, { headers: { accept: 'text/html' } });
      const csp = response.headers()['content-security-policy'] ?? '';
      const headerNonce = policy.exec(csp)?.[1];
      expect(headerNonce, `${path}: the header is NF-11.1's policy: ${csp}`).toBeDefined();
      const htmlNonce = /ngcspnonce=["']([^"']+)["']/i.exec(await response.text())?.[1];
      expect(htmlNonce, `${path}: the nonce in the HTML equals the one in the header`).toBe(headerNonce);
      nonces.push(headerNonce!);
    }
    expect(new Set(nonces).size, 'a fresh nonce per response').toBe(nonces.length);
  });

  test('runs without CSP or Trusted Types violations', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    await logIn(page);
    await expect(dashboardHeading(page)).toBeVisible();
  });

  test('applies the global styles', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).toContain('Inter');
    // The family is declared; check that the font file really loaded.
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "Inter Variable"');
    });
    expect(loaded).toBe(true);
  });

  test('serves the icon sprite', async ({ request }) => {
    const response = await request.get('/assets/icons.svg');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
  });

  test('does not scroll sideways at the device width', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'only the mobile projects have a phone viewport of their own');
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });

  test('NF-12.4: does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });
});

test.describe('expiring auth tokens', () => {
  test.use({ instanceOptions: SHORT_TOKENS });

  test('AC-AUTH-003.14: sends the user to the login page when the refresh fails', async ({ page, context, request, monitor, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_SECURE_COOKIES);
    await page.goto('/login');
    await logIn(page);
    await expect(dashboardHeading(page)).toBeVisible();

    // Revoke the session behind the web client's back.
    const cookie = await refreshCookie(context);
    expect(cookie).toBeDefined();
    const logout = await request.post('/api/v1/auth/session/logout', { data: { refreshToken: cookie?.value } });
    expect(logout.status()).toBe(204);

    await page.waitForTimeout(3_000);
    await page.reload();

    await expect(loginHeading(page)).toBeVisible();
    await expect(page.getByText('Your session has expired. Please log in again')).toBeVisible();
    await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
    drainFailedRequests(monitor, '/api/v1/me');
    drainFailedRequests(monitor, '/api/v1/repositories/recent');
    drainFailedRequests(monitor, '/api/v1/auth/session/refresh');
    // The dashboard's push channel connects with the expired token too.
    drainFailedRequests(monitor, '/api/v1/events');
    // So does the administrators' low-space banner (NF-9.7).
    drainFailedRequests(monitor, '/api/v1/instance/storage');
  });

  test('keeps the repository screen as it is while its tokens expire: no reload, and the editor keeps the focus', async ({ page, instance, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_SECURE_COOKIES);
    // Waiting for the background fetches, then for several tokens to expire.
    test.slow();
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' } ]
    }).repositoryIds;
    const dir = workingCopyOf(instance.dataDir, id);
    await page.goto(`/repositories/${id}/files/README.md`);
    await logIn(page);
    const editor = page.getByRole('main', { name: 'Editor' }).getByRole('textbox', { name: 'README.md', exact: true });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Typed.');
    await expect.poll(() => readFileSync(join(dir, 'README.md'), 'utf8'), { timeout: 40_000 }).toContain('Typed.');
    // The background fetches of a screen that opens, of a remote that never answers, read the status again when
    // they fail (GA-33, GA-35): the one of opening the file, shown in the bar or the git actions menu's button on a
    // phone, then the scheduler's, which looks at what is viewed every 5 seconds. The next comes 2 minutes later.
    const fetchFailed = 'Couldn\'t check for remote changes';
    await expect(
      page.locator('rs-fetch-status').getByText(fetchFailed)
        .or(page.getByRole('button', { name: `Git actions. ${fetchFailed}` }))
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(6_000);

    // What the screen reads again after its push channel reconnects (A-3.11).
    const reloads: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (/\/(git\/status|git\/merge|folder|file)$/.test(path) && request.method() === 'GET') {
        reloads.push(path);
      }
    });
    // Several 2-second tokens.
    await page.waitForTimeout(7_000);

    expect(reloads).toEqual([]);
    await expect(editor).toBeFocused();
    await page.keyboard.type(' Still here.');
    await expect.poll(() => readFileSync(join(dir, 'README.md'), 'utf8'), { timeout: 40_000 })
      .toContain('Typed. Still here.');
  });

  test('AC-AUTH-003.11: two tabs share one refresh', async ({ page, context, monitor, browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_SECURE_COOKIES);
    // Without a push channel, whose streams renew their tokens before they expire (A-8.5), the tokens expire.
    await context.route('**/api/v1/events*', route => route.abort());
    await page.goto('/login');
    await logIn(page);
    const other = await context.newPage();
    await other.goto('/');
    await expect(dashboardHeading(other)).toBeVisible();

    let refreshes = 0;
    context.on('request', request => {
      if (new URL(request.url()).pathname === '/api/v1/auth/session/refresh') {
        refreshes++;
      }
    });
    await page.waitForTimeout(3_000);
    // Both tabs ask for the current user with an expired token at once.
    await Promise.all([ page.reload(), other.reload() ]);

    await expect(dashboardHeading(page)).toBeVisible();
    await expect(dashboardHeading(other)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
    await expect(other.getByRole('button', { name: /^Account menu for / })).toBeVisible();
    expect(refreshes).toBe(1);
    // The dashboard asks for its list, and connects its push channel, with the expired token too.
    drainFailedRequests(monitor, '/api/v1/me');
    drainFailedRequests(monitor, '/api/v1/repositories/recent');
    drainFailedRequests(monitor, '/api/v1/events');
  });
});

test.describe('fixture', () => {
  test('records a CSP violation', async ({ page, monitor }) => {
    await page.route('**/csp-probe', route =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'content-security-policy': `default-src 'none'` },
        body: '<script>window.ran = true</script>'
      }));
    await page.goto('/csp-probe');
    await expect.poll(() => monitor.violations.length).toBeGreaterThan(0);
    expect(monitor.violations[0].directive).toContain('script-src');
    // Drain it, so the fixture's own check passes.
    monitor.violations.length = 0;
    monitor.consoleErrors.length = 0;
  });

  test('keeps violations from earlier page loads', async ({ page, monitor }) => {
    await page.route('**/csp-probe', route =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'content-security-policy': `default-src 'none'` },
        body: '<script>window.ran = true</script>'
      }));
    await page.goto('/csp-probe');
    await expect.poll(() => monitor.violations.length).toBeGreaterThan(0);
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
    expect(monitor.violations.length).toBeGreaterThan(0);
    // Drain only what the probe page reported (a late one, such as Firefox's
    // blocked favicon request, included); a violation of /login stays and fails the test.
    const own = monitor.violations.filter(violation => violation.documentURI.endsWith('/csp-probe'));
    expect(own.length).toBeGreaterThan(0);
    monitor.violations.splice(0, monitor.violations.length, ...monitor.violations.filter(v => !own.includes(v)));
    // Its console errors too: logged from the probe page (WebKit's message does not quote the
    // policy) or quoting its policy (Firefox logs the blocked favicon from its own module).
    const ownErrors = monitor.consoleErrors.filter(error =>
      error.url.endsWith('/csp-probe') || error.text.includes(`default-src 'none'`)
    );
    expect(ownErrors.length).toBeGreaterThan(0);
    monitor.consoleErrors.splice(
      0,
      monitor.consoleErrors.length,
      ...monitor.consoleErrors.filter(error => !ownErrors.includes(error))
    );
  });
});

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  );
}
