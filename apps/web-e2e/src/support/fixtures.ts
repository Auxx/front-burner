import { test as base } from '@playwright/test';

import { type Instance, type InstanceOptions, startInstance, TEST_TOKEN } from './instance';

export interface PolicyViolation {
  directive: string;
  blockedURI: string;
  /** The document that reported it. */
  documentURI: string;
}

export interface ConsoleError {
  text: string;
  /** Where it was logged from: the document or script URL (browsers word the same error differently). */
  url: string;
}

/** What the page reported so far; the fixture fails the test if any is left. */
export interface Monitor {
  violations: PolicyViolation[];
  consoleErrors: ConsoleError[];
}

/**
 * Once onboarding is completed, its state endpoint answers 404 on every page
 * load (AO-3), and browsers log the failed request.
 */
function isClosedOnboarding(error: ConsoleError): boolean {
  return new URL(error.url, 'http://x').pathname === '/api/v1/onboarding' && error.text.includes('404');
}

/**
 * `test` with its own instance of Front Burner as `baseURL`, configured by
 * `instanceOptions` (by default a fresh instance with a setup token), that
 * fails when a page logs a console error or reports a
 * `securitypolicyviolation` (CSP or Trusted Types). Both are collected on the
 * Node side, so they survive navigations. A test that provokes one on purpose
 * drains `monitor` itself.
 */
export const test = base.extend<{ instanceOptions: InstanceOptions; instance: Instance; monitor: Monitor; }>({
  instanceOptions: [ { setupToken: TEST_TOKEN }, { option: true } ],
  instance: async ({ instanceOptions }, use) => {
    const instance = await startInstance(instanceOptions);
    try {
      await use(instance);
    } finally {
      await instance.stop();
    }
  },
  baseURL: async ({ instance }, use) => {
    await use(instance.url);
  },
  monitor: [
    async ({ page }, use) => {
      const monitor: Monitor = { violations: [], consoleErrors: [] };
      page.on('console', message => {
        const error = { text: message.text(), url: message.location().url };
        if (message.type() === 'error' && !isClosedOnboarding(error)) {
          monitor.consoleErrors.push(error);
        }
      });
      page.on('pageerror', error => monitor.consoleErrors.push({ text: error.message, url: page.url() }));
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
