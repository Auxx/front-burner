# Centred Island Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 35 of [the design pass index](2026-10-30-00-design-pass.md): the
app shell's islands sit `8px 16px 16px` from the edges, routed pages fill
`<main>` instead of sticking to its bottom, and Onboarding, Login and Page not
found show their content on one centred island, with banners below it. Login
offers OIDC under an "or" divider and stops showing "You have been logged out"
once the user tries to log in.

**Architecture:** Two new `libs/ui` layout pieces: `ui-centred-island` (an
island centred in whatever block it fills, with a slot below it) and
`ui-divider` (a rule with an optional word). Page spacing becomes tokens in
`_shape.scss`, read by `ui-app-shell`. The three pages drop their own layout
SCSS.

**Tech Stack:** Angular (signals, standalone components), `@hexmode/toolkit-nx`
generators, Transloco, Vitest, Storybook, Playwright.

**Spec:** [design](../specs/2026-10-30-islands-design-pass-design.md) Shared
layouts 1, 3, 4; Per page: Onboarding, Login, Page not found; G2 (removing the
copies on these pages). REQ-AUTH-003 (LG-9), NV-3.

## Global Constraints

- The shared constraints of [the index](2026-10-30-00-design-pass.md) apply.
- Body padding around islands, desktop: **8 px top (`--ui-space-2`), 16 px
  inline and bottom (`--ui-space-4`)**. Gap between neighbouring islands: **8 px
  (`--ui-space-2`)**. Narrow screens keep today's values (`--ui-space-1` gap and
  padding, smaller radius; A-10.6).
- Centred island widths: Onboarding **28rem**, Login **24rem**, Page not found
  **24rem** _(plan's call)_; padding inside the island `--ui-space-5` block,
  `--ui-space-6` inline _(plan's call, the mockup's 20 / 24 px)_.
- Login: every banner (`message`, `oidcError`, `insecure`, `failure`) is
  **below** the island; the island holds the `h1`, the form, and the OIDC part.
- OIDC: a divider with the word **"or"** above **Log in with OIDC** and above
  "OIDC login is not available right now."; nothing when OIDC is not configured.
- Login messages (`logged-out`, `session-expired`, `password-reset`) disappear
  on the first submit and are not shown again on that page.

## Review Focus

- **A long Onboarding step (the OIDC setup form) taller than the window** must
  scroll the page, not be clipped or centred off the top (Task 2 story with tall
  content at 480 × 400).
- **Several banners at once** (insecure + OIDC error + failure) stack below the
  island in a stable order: failure first, then OIDC error, then the insecure
  warning _(plan's call: the newest, most specific first)_ (Task 4 test).
- **Route focus** still lands on the `h1` inside the island after navigating to
  Login from a logout (Task 4 test reuses the existing focus check).
- **Login at 320 px**: island and banners take the full width minus the page
  padding, no sideways scroll (Task 4 screenshot `--viewport 320x640` of the
  running page).
- **Page not found inside a repository URL** (`/repositories/999`) uses the same
  centred island inside the app shell (plan 37 reuses this; Task 5 checks the
  shell route).

---

### Task 1: Page spacing tokens and pages that fill `<main>`

**Files:**

- Modify: `libs/ui/src/styles/tokens/_shape.scss`
- Modify: `libs/ui/src/layout/components/app-shell/app-shell.component.scss`
- Modify: `libs/ui/src/layout/components/split-pane/split-pane.component.scss:5`
  (reads `--ui-island-gap`, unchanged name)
- Test: `apps/web-e2e/src/dashboard.spec.ts`

**Interfaces:**

- Produces tokens: `--ui-page-padding-block-start`, `--ui-page-padding-inline`,
  `--ui-page-padding-block-end` (desktop `space-2` / `space-4` / `space-4`;
  narrow all `--ui-space-1`), and `--ui-island-gap` = `--ui-space-2` on desktop
  (narrow unchanged). The header (plan 36) aligns to `--ui-page-padding-inline`.

- [ ] **Step 1: Write the failing end-to-end test**

In `dashboard.spec.ts`, logged in, on `/`:

```ts
test('the dashboard starts at the top of main, not at its bottom', async ({ page }) => {
  const main = await page.locator('main').boundingBox();
  const content = await page.locator('main > :not(router-outlet)').first().boundingBox();
  expect(content!.y - main!.y).toBeLessThan(1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx nx run web-e2e:e2e --grep "top of main"` Expected: FAIL, the
difference is the height of `main` minus the page's height.

- [ ] **Step 3: Fix the grid and the padding**

`main` keeps one cell; every projected child is placed in it (`grid-area: 1 /
1`), so the empty `router-outlet` element and the routed page share the cell
_(plan's call: fixed once in `ui-app-shell`, which reaches projected children
with `::ng-deep` scoped under `:host main`, rather than in each page)_. `.body`
padding uses the three new tokens; `.header` padding-inline uses
`--ui-page-padding-inline` (plan 36 adds its block padding).

- [ ] **Step 4: Run the test to see it pass; run `npx nx run ui:test`.**

- [ ] **Step 5: Commit**

```bash
git add libs/ui/src apps/web-e2e/src/dashboard.spec.ts
git commit -m "Page padding tokens; routed pages fill main (plan 35)"
```

### Task 2: `ui-centred-island`

**Files:**

- Create (with the `toolkit-nx` component generator, in `libs/ui`, layout
  group):
  `libs/ui/src/layout/components/centred-island/centred-island.component.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces: `CentredIslandComponent`, selector `ui-centred-island`; input
  `width = input('28rem')` (the island's max inline size); the default slot goes
  into a `ui-island` with the padding of the Global Constraints;
  `[uiCentredIslandAfter]` projects below the island, stacked with
  `--ui-space-3` gap. The host fills its container (`min-block-size: 100%`),
  centres the column both ways with `--ui-space-4` around it, and lets a column
  taller than the container scroll from its top.

- [ ] **Step 1: Write the failing spec**

`centred-island.component.spec.ts`: renders projected content inside a
`ui-island`; renders `[uiCentredIslandAfter]` content after the island and
outside it; sets the island's max inline size from `width`.

- [ ] **Step 2: Run it to see it fail** (`npx nx run ui:test`), then implement,
      then run it to see it pass.

- [ ] **Step 3: Stories** "Default" (a heading, two fields, a button), "With
      banners after", "Taller than the window" (play: the island's top is
      visible, `getBoundingClientRect().top >= 0`). Screenshot `--theme dark
      --viewport 1024x640` and `--viewport 320x640`.

- [ ] **Step 4: Commit**

```bash
git add libs/ui/src
git commit -m "ui-centred-island layout (plan 35)"
```

### Task 3: `ui-divider`

**Files:**

- Create (generator):
  `libs/ui/src/content/components/divider/divider.component.{ts,scss,spec.ts,stories.ts}`
- Modify: `libs/ui/src/index.ts`

**Interfaces:**

- Produces: `DividerComponent`, selector `ui-divider`, `role="separator"`;
  optional projected text, drawn between two `--ui-border-subtle` lines in
  `--ui-text-subtle`, `--ui-font-size-ui-small`; vertical margin `--ui-space-1`.

- [ ] **Step 1: Failing spec**: has `role="separator"`; with text, shows it;
      without text, one line. Run, implement, run (`npx nx run ui:test`).
- [ ] **Step 2: Story** with and without "or"; screenshot both themes.
- [ ] **Step 3: Commit** `git commit -m "ui-divider (plan 35)"`.

### Task 4: Login

**Files:**

- Modify: `libs/web/feature-auth/src/auth/pages/login/login.page.{html,scss,ts}`
- Test: `libs/web/feature-auth/src/auth/pages/login/login.page.spec.ts`
- Modify: `docs/requirements/auth-login.md` (LG-9, the one-off message)

**Interfaces:**

- Consumes: `ui-centred-island` (`width="24rem"`, `[uiCentredIslandAfter]`),
  `ui-divider`.
- Changes: `message` becomes `signal<LoginMessage | null>`, set from
  `loginMessage()` at construction and set to `null` at the start of `submit`.

- [ ] **Step 1: Write the failing tests**

```ts
it('drops the logged-out message on the first login attempt', async () => {
  login.mockRejectedValueOnce(wrongCredentials());   // as in the existing wrong-credentials test
  await open('/login', { state: { loginMessage: 'logged-out' } });
  await fillIn();
  await submit();
  expect(page().querySelector('ui-inline-banner[status="info"]')).toBeNull();
  expect(page().querySelector('ui-inline-banner[status="danger"]')).not.toBeNull();
});

it('shows the banners below the island, not inside it', async () => {
  await open('/login', { state: { loginMessage: 'logged-out' } });
  expect(page().querySelector('ui-island ui-inline-banner')).toBeNull();
  expect(page().querySelector('[uiCentredIslandAfter] ui-inline-banner, ui-centred-island > * ui-inline-banner')).not.toBeNull();
});

it('separates OIDC from the form with "or"', async () => {
  methods = { oidc: 'available', passwordReset: false };
  await open();
  expect(page().querySelector('ui-island ui-divider')?.textContent).toContain(`${KEY}.or`);
});
```

Adjust the "below the island" selector to the slot the component defines; the
assertion is that no banner is a descendant of `ui-island`. Add the banner-order
test from Review Focus.

- [ ] **Step 2: Run them to see them fail**

Run: `npx nx run web-feature-auth:test` Expected: the three new tests FAIL.

- [ ] **Step 3: Rebuild the template**

`<main>` (it keeps `min-block-size: 100dvh`) → `ui-centred-island` → `h1` and
the form, then the OIDC part with `<ui-divider>{{ t('or') }}</ui-divider>` (only
when OIDC is `available` or `unavailable`). Banners move into
`[uiCentredIslandAfter]` in the Review Focus order. Delete the page's own
`main`, `.content`, `.heading` rules; keep only what is specific (the actions
row, the reference line). The `h1` keeps `tabindex="-1"`. Add the key
`web-feature-auth.LoginPage.or` = "or" to `apps/web/public/i18n/en.json`.

- [ ] **Step 4: Run the tests to see them pass; run `npx nx run web-e2e:e2e
      --grep login`.**

- [ ] **Step 5: Screenshot** the running page in dark mode at 1440 × 900 with
      `logged-out` + insecure, and after a failed login; compare with
      `login-banners.html` option B and `login-oidc.html` option B.

- [ ] **Step 6: Requirement text**: add to LG-9 "It is shown until the user's
      first login attempt on that page."

- [ ] **Step 7: Commit**

```bash
git add libs/web/feature-auth apps/web/public/i18n/en.json docs/requirements
git commit -m "Login on a centred island; banners below; OIDC under 'or'; message clears on submit (plan 35)"
```

### Task 5: Onboarding and Page not found

**Files:**

- Modify:
  `libs/web/feature-auth/src/auth/pages/onboarding/onboarding.page.{html,scss}`
- Modify: `libs/web/feature-auth/src/auth/styles/_step.scss` (drop heading sizes
  that G2 now gives)
- Modify:
  `libs/web/shell/src/shell/pages/page-not-found/page-not-found.page.{html,scss}`
- Test: `onboarding.page.spec.ts`, `page-not-found.page.spec.ts`
- Modify: `docs/architecture/design-system.md` (component table:
  `CentredIsland`, `Divider` under Layout and Content)

- [ ] **Step 1: Failing tests**: Onboarding renders its `h1` and the current
      step inside `ui-island`, and its failure banner outside it; Page not found
      renders its `h1` and the Dashboard link inside `ui-island`.
- [ ] **Step 2: Run** `npx nx run web-feature-auth:test` and `npx nx run
      web-shell:test`; expected FAIL.
- [ ] **Step 3: Implement** with `ui-centred-island` (`28rem`, `24rem`). Page
      not found's host fills `<main>` (Task 1) so the island is centred in it.
      Delete the replaced SCSS (`main`, `.content`, `.heading`, `:host`
      padding).
- [ ] **Step 4: Run the tests and `npx nx run web-e2e:e2e --grep onboarding`**;
      expected PASS.
- [ ] **Step 5: Screenshot** Onboarding's token step and a missing route, dark,
      1440 × 900; compare with `onboarding-surfaces.html` (right side).
- [ ] **Step 6: Docs and finish**: component table; `doc-ids.mjs check`; `npx nx
      affected -t lint,test,build`; `npx nx format:write`; index row **Done**.
- [ ] **Step 7: Commit**

```bash
git add libs/web apps docs
git commit -m "Onboarding and Page not found on a centred island (plan 35)"
```
