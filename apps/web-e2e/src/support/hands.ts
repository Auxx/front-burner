import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, settled, test } from './fixtures';

export { settled };

/**
 * Taps `target` in a project with touch, a phone, and clicks it otherwise:
 * WebKit's iPhone can drop a mouse click, and a phone is used by touch
 * anyway (A-8.20).
 */
export async function press(target: Locator): Promise<void> {
  await (test.info().project.use.hasTouch === true ? target.tap() : target.click());
}

/**
 * The editor's shortcut `key` with the modifier CodeMirror uses on this page:
 * Cmd on Apple's systems, as the phone projects' iPhone is whatever the tests
 * run on, and Ctrl elsewhere. Playwright's `ControlOrMeta` follows the system
 * the tests run on instead. Worked out as `@codemirror/view` does.
 */
export async function shortcut(page: Page, key: string): Promise<string> {
  const apple = await page.evaluate(() => {
    const ios = /Apple Computer/.test(navigator.vendor)
      && (/Mobile\/\w+/.test(navigator.userAgent) || navigator.maxTouchPoints > 2);
    return ios || /Mac/.test(navigator.platform);
  });
  return `${apple ? 'Meta' : 'Control'}+${key}`;
}

/** Checks the page, or only the parts that `selectors` name, with axe-core once it has settled. */
export async function axe(page: Page, ...selectors: string[]): Promise<void> {
  await settled(page);
  let builder = new AxeBuilder({ page });
  for (const selector of selectors) {
    builder = builder.include(selector);
  }
  expect((await builder.analyze()).violations).toEqual([]);
}

/**
 * Collects what the CDK live announcer says, from the next page load on, so
 * that a test can check what was announced and how often (RC-25, GC-28).
 */
export async function recordAnnouncements(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { announcements: string[]; }).announcements = said;
    new MutationObserver(records => {
      for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        const region = element?.closest('.cdk-live-announcer-element');
        const text = region?.textContent?.trim();
        if (region && text) {
          said.push(text);
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => [ ...(window as unknown as { announcements: string[]; }).announcements ]);
}

/**
 * Presses Shift+Tab until `target` has the focus, and checks that the focus
 * can be seen (NF-13.3). Backwards, because the editor is the last control of
 * the page, and Firefox keeps the focus there on Tab. The editor takes Tab for
 * indenting until Escape is pressed (ED-11).
 *
 * Past the first or last control, headless browsers put the focus on the body,
 * where a browser's own controls would take it. From there, Firefox goes on
 * from the selection, which is cleared for it, and WebKit keeps the focus on
 * the body on Shift+Tab: when Shift+Tab comes back to where it has been
 * without reaching `target`, it goes on with Tab.
 */
export async function tabTo(page: Page, target: Locator, limit = 150): Promise<void> {
  // A toolbar is one stop of Tab, and its arrow keys move between its buttons (NF-13.4).
  const orientation = await target.evaluate(element =>
    element.closest('[role="toolbar"]')?.getAttribute('aria-orientation') ?? null
  );
  const reached = () =>
    target.evaluate((element, inToolbar) => {
      const active = document.activeElement;
      return inToolbar ? element.closest('[role="toolbar"]')?.contains(active) === true : element === active;
    }, orientation !== null);
  let key = 'Shift+Tab';
  await page.evaluate(() => ((window as unknown as { tabToSeen: WeakSet<Element>; }).tabToSeen = new WeakSet()));
  for (let presses = 0; !(await reached()); presses++) {
    if (presses === limit) {
      throw new Error(`Tab did not reach ${target}`);
    }
    const { inEditor, again } = await page.evaluate(() => {
      const active = document.activeElement ?? document.body;
      const seen = (window as unknown as { tabToSeen?: WeakSet<Element>; }).tabToSeen ??= new WeakSet();
      const visited = seen.has(active);
      seen.add(active);
      if (active === document.body) {
        // Where a browser's own controls would take the focus. Firefox goes on
        // from the selection, such as in a field typed in before.
        window.getSelection()?.removeAllRanges();
      }
      return { inEditor: active.closest('.cm-editor') !== null, again: visited };
    });
    if (again && key === 'Shift+Tab') {
      key = 'Tab';
    }
    if (inEditor) {
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press(key);
  }
  if (orientation !== null) {
    await arrowTo(page, target, orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
  }
  expect(await target.evaluate(element => element.matches(':focus-visible')), 'the focus is visible').toBe(true);
}

/** Presses `key` until `target` has the focus, such as an item of an open menu. */
export async function arrowTo(page: Page, target: Locator, key = 'ArrowDown', limit = 20): Promise<void> {
  for (let presses = 0; presses < limit; presses++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press(key);
  }
  throw new Error(`${key} did not reach ${target}`);
}

/**
 * How a walkthrough works the screen: with the keyboard alone on a desktop,
 * or by touch alone on a phone (GA-6, NF-12.5).
 */
export interface Hands {
  /** Activates a button, a link or a menu item. */
  press(target: Locator): Promise<void>;
  /** Asks an unavailable button why: a keyboard press or a tap shows its reason (GA-8). */
  explain(target: Locator): Promise<void>;
  /** Ticks or unticks a checkbox. */
  toggle(target: Locator): Promise<void>;
  /** Types `text` at the end of a field or the editor. */
  typeInto(target: Locator, text: string): Promise<void>;
  /** Chooses the radio button `name` of `group`. */
  choose(group: Locator, name: string): Promise<void>;
  /**
   * A git action of the bar, such as **Pull** or **Commit merge**: its button
   * on a desktop, or the item of the git actions menu on a phone (GA-7, GC-6).
   */
  gitAction(name: string): Promise<void>;
}

/** The bar itself, not the banner landmark: the notices below the bar have buttons of their own, such as **Pull**. */
const repositoryBar = (page: Page) => page.locator('rs-repository-bar');

/** {@link Hands} with the keyboard alone. */
export function keyboard(page: Page): Hands {
  const hands: Hands = {
    press: async target => {
      await tabTo(page, target);
      await page.keyboard.press('Enter');
    },
    explain: async target => {
      await tabTo(page, target);
      await page.keyboard.press('Enter');
    },
    toggle: async target => {
      await tabTo(page, target);
      await page.keyboard.press('Space');
    },
    typeInto: async (target, text) => {
      await tabTo(page, target);
      await page.keyboard.press(await shortcut(page, 'End'));
      await page.keyboard.type(text);
    },
    choose: async (group, name) => {
      const radios = group.getByRole('radio');
      const checked = radios.and(group.locator(':checked'));
      await tabTo(page, (await checked.count()) > 0 ? checked : radios.first());
      await arrowTo(page, group.getByRole('radio', { name }));
      await expect(group.getByRole('radio', { name })).toBeChecked();
    },
    gitAction: async name => {
      await hands.press(repositoryBar(page).getByRole('button', { name, exact: true }));
    }
  };
  return hands;
}

/** {@link Hands} by touch alone. */
export function touch(page: Page): Hands {
  return {
    press: target => target.tap(),
    // `force`: Playwright waits for an `aria-disabled` button to be enabled, but a tap here says why.
    explain: target => target.tap({ force: true }),
    toggle: target => target.tap(),
    typeInto: async (target, text) => {
      await target.tap();
      await page.keyboard.press(await shortcut(page, 'End'));
      await page.keyboard.type(text);
    },
    // The radio is visually hidden, so its label is tapped.
    choose: async (group, name) => {
      await group.getByText(name, { exact: true }).tap();
      await expect(group.getByRole('radio', { name })).toBeChecked();
    },
    gitAction: async name => {
      await repositoryBar(page).getByRole('button', { name: /^Git actions/ }).tap();
      await page.getByRole('menuitem', { name: new RegExp(`^\\s*${name}`) }).tap();
    }
  };
}
