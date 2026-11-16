import type { Page } from '@playwright/test';

const API = '**/api/v1/**';

/**
 * Answers the page's API requests as an instance upgraded to `version` would:
 * the backend's answers, with `X-Front-Burner-Version` set to it (NF-7.6).
 * The returned function stops it, as the reloaded web client of that version
 * would match the backend again.
 */
export async function answerWithVersion(page: Page, version: string): Promise<() => Promise<void>> {
  await page.route(API, async route => {
    // The push channel never ends, so its answer cannot be read whole.
    if (new URL(route.request().url()).pathname === '/api/v1/events') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'x-front-burner-version': version } });
  });
  return () => page.unroute(API);
}
