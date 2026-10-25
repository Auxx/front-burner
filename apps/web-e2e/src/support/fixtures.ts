import { test as base } from '@playwright/test';

export interface PolicyViolation {
  directive: string;
  blockedURI: string;
  /** The document that reported it. */
  documentURI: string;
}

/** What the page reported so far; the fixture fails the test if any is left. */
export interface Monitor {
  violations: PolicyViolation[];
  consoleErrors: string[];
}

/**
 * `test` that fails when a page logs a console error or reports a
 * `securitypolicyviolation` (CSP or Trusted Types). Both are collected on the
 * Node side, so they survive navigations. A test that provokes one on purpose
 * drains `monitor` itself.
 */
export const test = base.extend<{ monitor: Monitor; }>({
  monitor: [
    async ({ page }, use) => {
      const monitor: Monitor = { violations: [], consoleErrors: [] };
      page.on('console', message => {
        if (message.type() === 'error') {
          monitor.consoleErrors.push(message.text());
        }
      });
      page.on('pageerror', error => monitor.consoleErrors.push(error.message));
      await page.exposeBinding('reportPolicyViolation', (_source, violation: PolicyViolation) => {
        monitor.violations.push(violation);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', event => {
          (window as unknown as {
            reportPolicyViolation(violation: PolicyViolation): void;
          }).reportPolicyViolation({
            directive: event.violatedDirective,
            blockedURI: event.blockedURI,
            documentURI: event.documentURI
          });
        });
      });

      await use(monitor);

      base.expect(monitor.violations, 'security policy violations').toEqual([]);
      base.expect(monitor.consoleErrors, 'console errors').toEqual([]);
    },
    { auto: true }
  ]
});

export const expect = base.expect;
