import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

test.describe('login page', () => {
  for (const url of [ '/', '/no/such/page' ]) {
    test(`any URL ends on the login page: ${url}`, async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
      await expect(page).toHaveTitle('Log in · Front Burner');
    });
  }

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
    await expect(page.getByText(`Signing in isn't available yet.`)).toBeVisible();
  });

  test('applies the global styles', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  });

  test('does not scroll sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in', exact: true })).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
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
