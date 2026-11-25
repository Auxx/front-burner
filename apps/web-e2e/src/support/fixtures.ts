import { type BrowserContext, test as base } from '@playwright/test';

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

/** How each browser reports a request it cancelled itself: Chromium, Firefox, WebKit. */
const CANCELLED = new Set([ 'net::ERR_ABORTED', 'NS_BINDING_ABORTED', 'Load request cancelled' ]);

/**
 * The address of a failed request that a message names, where the browser
 * words it differently from Chromium's "Failed to load resource" (which gives
 * the address as the message's location): WebKit's failed fetches and module
 * loads, and Firefox's failed font downloads.
 */
function failedRequestUrl(text: string): string | undefined {
  return /^(?:Fetch API cannot load|Cannot load) (\S+) due to access control checks\.$/.exec(text)?.[1]
    ?? /downloadable font: download failed .* source: (\S+?)"?\]?$/.exec(text)?.[1];
}

/**
 * The Firefox of Playwright 1.65 (build 1572) crashes the page when a script
 * reads an ARIA element-reflection property, such as `ariaLabelledByElements`,
 * that Playwright's own world has read too (playwright#44135), as axe-core
 * 4.14 does in every accessibility check. Without them, axe-core reads the
 * attributes instead, with the same result for the web client, which sets
 * only the attributes. Remove once Playwright ships a fixed Firefox.
 */
async function withoutElementReflection(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    for (const name of Object.getOwnPropertyNames(Element.prototype)) {
      if (/^aria[A-Za-z]+Elements?$/.test(name)) {
        Reflect.deleteProperty(Element.prototype, name);
      }
    }
  });
}

/**
 * `test` with its own instance of Front Burner as `baseURL`, configured by
 * `instanceOptions` (by default a fresh instance with a setup token), that
 * fails when a page logs a console error or reports a
 * `securitypolicyviolation` (CSP or Trusted Types). Both are collected on the
 * Node side, so they survive navigations. A test that provokes one on purpose
 * drains `monitor` itself. Chromium logs nothing for the loads a navigation
 * cuts short or the browser cancels; Firefox and WebKit do, so with them the
 * errors logged while a page is left, and those of cancelled requests, do not
 * count. Chromium's runs keep checking the rest.
 */
export const test = base.extend<{ instanceOptions: InstanceOptions; instance: Instance; monitor: Monitor; }>({
  // Tests that open a context of their own get the Firefox workaround too.
  browser: [
    async ({ browser, browserName }, use) => {
      if (browserName === 'firefox') {
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async options => {
          const context = await newContext(options);
          await withoutElementReflection(context);
          return context;
        };
      }
      await use(browser);
    },
    { scope: 'worker' }
  ],
  context: async ({ context, browserName }, use) => {
    if (browserName === 'firefox') {
      await withoutElementReflection(context);
    }
    await use(context);
  },
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
    async ({ page, browserName }, use) => {
      const monitor: Monitor = { violations: [], consoleErrors: [] };
      const strict = browserName === 'chromium';
      // The requests the browser cancelled itself, such as on a navigation.
      const cancelled = new Set<string>();
      let leaving = false;
      const record = (error: ConsoleError) => {
        if (!isClosedOnboarding(error) && (strict || !leaving)) {
          monitor.consoleErrors.push(error);
        }
      };
      page.on('console', message => {
        if (message.type() === 'error') {
          record({ text: message.text(), url: failedRequestUrl(message.text()) ?? message.location().url });
        }
      });
      page.on('pageerror', error => {
        // WebKit reports a failed fetch as an error of the page; its message
        // starts in `name`, up to the colon of the URL.
        const text = error.stack?.split('\n')[0] ?? error.message;
        const url = failedRequestUrl(text);
        record(url ? { text, url } : { text: error.message, url: page.url() });
      });
      page.on('requestfailed', request => {
        if (CANCELLED.has(request.failure()?.errorText ?? '')) {
          cancelled.add(request.url());
        }
      });
      // Firefox and WebKit report the loads that leaving a page cuts short.
      page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          leaving = true;
        }
      });
      // Until the next page takes over, whose own errors count.
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) {
          leaving = false;
        }
      });
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

      if (!strict) {
        const kept = monitor.consoleErrors.filter(error => !cancelled.has(error.url));
        monitor.consoleErrors.splice(0, monitor.consoleErrors.length, ...kept);
      }
      base.expect(monitor.violations, 'security policy violations').toEqual([]);
      base.expect(monitor.consoleErrors, 'console errors').toEqual([]);
    },
    { auto: true }
  ]
});

export const expect = base.expect;

/**
 * Why a test that needs the refresh cookie (LG-32) or the OIDC state cookie
 * (LG-17) is skipped in WebKit: both are `Secure`, and WebKit keeps no
 * `Secure` cookie on `http://localhost`, where the tests run (WebKit bug
 * 281149). Chromium and Firefox run these tests.
 */
export const WEBKIT_SECURE_COOKIES = 'WebKit keeps no Secure cookie over plain HTTP on localhost (WebKit bug 281149)';

/**
 * Removes the console errors browsers log for failed requests to `pathname`,
 * for a test that expects them, such as a refused login.
 */
export function drainFailedRequests(monitor: Monitor, pathname: string): void {
  const failed = (error: ConsoleError) => new URL(error.url, 'http://x').pathname === pathname;
  monitor.consoleErrors.splice(
    0,
    monitor.consoleErrors.length,
    ...monitor.consoleErrors.filter(error => !failed(error))
  );
}
