import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { drainFailedRequests, expect, test } from './support/fixtures';
import { logIn, TEST_ADMIN } from './support/instance';

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

  test('logs in and goes to the page asked for, with the refresh token in a cookie', async ({ page, context }) => {
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

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('is served with a nonce-based CSP', async ({ page }) => {
    const nonces: string[] = [];
    for (let load = 0; load < 2; load++) {
      const response = await page.goto('/login');
      const csp = response?.headers()['content-security-policy'] ?? '';
      expect(csp).toContain(`'nonce-`);
      expect(csp).toContain(`require-trusted-types-for 'script'`);
      const headerNonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
      const htmlNonce = /ngcspnonce=["']([^"']+)["']/i.exec(await response!.text())?.[1] ?? '';
      expect(htmlNonce, 'nonce in the served HTML').not.toBe('');
      expect(htmlNonce, 'nonce in the HTML equals the one in the header').toBe(headerNonce);
      nonces.push(headerNonce);
    }
    expect(nonces[0]).not.toBe('');
    expect(nonces[0]).not.toBe(nonces[1]);
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

  test('does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });
});

test.describe('expiring auth tokens', () => {
  test.use({ instanceOptions: SHORT_TOKENS });

  test('AC-AUTH-003.14: sends the user to the login page when the refresh fails', async ({ page, context, request, monitor }) => {
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
  });

  test('AC-AUTH-003.11: two tabs share one refresh', async ({ page, context, monitor }) => {
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
