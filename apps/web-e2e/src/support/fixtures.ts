import { test as base } from '@playwright/test';

interface PolicyViolation {
  directive: string;
  blockedURI: string;
}

declare global {
  interface Window {
    __policyViolations: PolicyViolation[];
  }
}

/**
 * `test` that fails when a page logs a console error or reports a
 * `securitypolicyviolation` (CSP or Trusted Types).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.addInitScript(() => {
      window.__policyViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.__policyViolations.push({
          directive: event.violatedDirective,
          blockedURI: event.blockedURI
        });
      });
    });

    await use(page);

    const violations = await page
      .evaluate(() => window.__policyViolations ?? [])
      .catch(() => []);
    base.expect(violations, 'security policy violations').toEqual([]);
    base.expect(consoleErrors, 'console errors').toEqual([]);
  }
});

export const expect = base.expect;
