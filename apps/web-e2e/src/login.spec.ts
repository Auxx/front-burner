import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/fixtures';

test.describe('login page', () => {
  for (const url of [ '/', '/no/such/page' ]) {
    test(`any URL ends on the login page: ${url}`, async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
      await expect(page).toHaveTitle('Log in · Front Burner');
    });
  }

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
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
      nonces.push(/'nonce-([^']+)'/.exec(csp)?.[1] ?? '');
    }
    expect(nonces[0]).not.toBe('');
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test('runs without CSP or Trusted Types violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByText(`Signing in isn't available yet.`)).toBeVisible();
  });

  test('applies the global styles', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).toContain('Inter');
  });

  test('serves the icon sprite', async ({ request }) => {
    const response = await request.get('/assets/icons.svg');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
  });

  test('does not scroll sideways at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(fits).toBe(true);
  });
});
