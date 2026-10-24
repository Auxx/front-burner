import { MenuHarness, MenuItemHarness, type MenuItemHarnessFilters } from '@angular/aria/menu/testing';
import { HarnessLoader, HarnessPredicate } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MenuGroupDirective } from '../../directives/menu-group/menu-group.directive';
import { MenuTriggerDirective } from '../../directives/menu-trigger/menu-trigger.directive';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { MenuSeparatorComponent } from '../menu-separator/menu-separator.component';
import { MenuComponent } from './menu.component';

// The Aria harnesses find `[ngMenu]` and `[ngMenuItem]`, attributes that host
// directives do not add. `MenuHarness` also builds its items from the base
// `MenuItemHarness`, so it needs `getItems` overridden to find ours.
class UiMenuItemHarness extends MenuItemHarness {
  static override hostSelector = '[uiMenuItem]';

  static override with(options: MenuItemHarnessFilters = {}): HarnessPredicate<UiMenuItemHarness> {
    return new HarnessPredicate(UiMenuItemHarness, options)
      .addOption('text', options.text, (harness, text) => HarnessPredicate.stringMatches(harness.getText(), text))
      .addOption('disabled', options.disabled, async (harness, disabled) => (await harness.isDisabled()) === disabled);
  }
}

class UiMenuHarness extends MenuHarness {
  static override hostSelector = 'ui-menu';

  override async getItems(filters: MenuItemHarnessFilters = {}): Promise<UiMenuItemHarness[]> {
    return await this.locatorForAll(UiMenuItemHarness.with(filters))();
  }
}

@Component({
  imports: [ MenuComponent, MenuItemComponent, MenuSeparatorComponent, MenuTriggerDirective ],
  template: `
    <button [uiMenuTrigger]="menu.aria">Git actions</button>
    <ui-menu #menu="uiMenu" (itemSelected)="chosen.set($event); selections = selections + 1">
      <button uiMenuItem="fetch">Fetch</button>
      <button uiMenuItem="pull">Pull</button>
      <div uiMenuSeparator></div>
      <a uiMenuItem="settings" href="/repositories/1/settings" (click)="linkClicks = linkClicks + 1; $event.preventDefault()">Repository settings</a>
    </ui-menu>
    <button>Outside</button>
  `
})
class HostComponent {
  readonly chosen = signal<unknown>(undefined);
  linkClicks = 0;
  selections = 0;
}

@Component({
  imports: [ MenuComponent, MenuGroupDirective, MenuItemComponent, MenuTriggerDirective ],
  template: `
    <button [uiMenuTrigger]="menu.aria">Repositories</button>
    <ui-menu #menu="uiMenu">
      <div uiMenuGroup label="Recent">
        <button uiMenuItem="notes">Notes</button>
      </div>
    </ui-menu>
  `
})
class GroupHostComponent {
}

@Component({
  imports: [ MenuComponent, MenuItemComponent, MenuTriggerDirective ],
  template: `
    <button [uiMenuTrigger]="menu.aria">First row</button>
    <button [uiMenuTrigger]="menu.aria">Second row</button>
    <ui-menu #menu="uiMenu">
      <button uiMenuItem="rename">Rename</button>
    </ui-menu>
  `
})
class SharedHostComponent {
}

describe('MenuComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let loader: HarnessLoader;

  const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement;
  // `[uiMenuTrigger]` is a property binding, so it leaves no attribute to query.
  const button = (text: string) =>
    [ ...fixture.nativeElement.querySelectorAll('button') ].find(b =>
      b.textContent.trim() === text
    ) as HTMLButtonElement;
  const item = (value: string) => document.querySelector(`[uiMenuItem="${value}"]`) as HTMLElement;
  const inOverlay = () => document.querySelector('.cdk-overlay-container ui-menu');
  const activeText = () => document.activeElement?.textContent?.trim();
  let trigger: HTMLButtonElement;

  const press = async (key: string, target = document.activeElement as HTMLElement) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };

  const open = async () => {
    trigger.click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent, GroupHostComponent, SharedHostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await fixture.whenStable();
    trigger = button('Git actions');
  });

  it('describes the trigger as a closed menu button', async () => {
    const menu = await loader.getHarness(UiMenuHarness);

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.type).toBe('button');
    expect(await menu.isOpen()).toBe(false);
  });

  it('opens on click into the overlay with focus on the first item', async () => {
    await open();

    const menu = await loader.getHarness(UiMenuHarness);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(await menu.isOpen()).toBe(true);
    expect(inOverlay()).not.toBeNull();
    expect(activeText()).toBe('Fetch');
  });

  for (const key of [ 'ArrowDown', 'Enter' ]) {
    it(`opens from the keyboard with ${key}`, async () => {
      trigger.focus();
      await press(key);

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(inOverlay()).not.toBeNull();
      expect(activeText()).toBe('Fetch');
    });
  }

  it('moves between items with the arrow keys', async () => {
    await open();

    await press('ArrowDown');
    expect(activeText()).toBe('Pull');

    await press('ArrowDown');
    expect(activeText()).toBe('Repository settings');

    await press('ArrowDown');
    expect(activeText()).toBe('Fetch');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    await open();

    await press('Escape');

    expect(inOverlay()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('emits the chosen value, closes and refocuses the trigger', async () => {
    await open();
    const menu = await loader.getHarness(UiMenuHarness);
    const [ , pull ] = await menu.getItems();

    await pull.click();
    await fixture.whenStable();

    expect(host.chosen()).toBe('pull');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('follows a link item once with Enter or a click', async () => {
    await open();
    await press('End');
    expect(activeText()).toBe('Repository settings');
    await press('Enter');

    expect(host.linkClicks).toBe(1);
    expect(host.selections).toBe(1);
    expect(host.chosen()).toBe('settings');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await open();
    const menu = await loader.getHarness(UiMenuHarness);
    const [ settings ] = await menu.getItems({ text: 'Repository settings' });
    await settings.click();
    await fixture.whenStable();

    expect(host.linkClicks).toBe(2);
    expect(host.selections).toBe(2);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when the focus leaves it', async () => {
    await open();

    button('Outside').focus();
    await fixture.whenStable();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(inOverlay()).toBeNull();
  });

  it('marks separators and groups for assistive technology', async () => {
    expect(item('fetch').getAttribute('role')).toBe('menuitem');
    expect(el('[uiMenuSeparator]').getAttribute('role')).toBe('separator');

    const groupFixture = TestBed.createComponent(GroupHostComponent);
    await groupFixture.whenStable();
    const group = groupFixture.nativeElement.querySelector('[uiMenuGroup]') as HTMLElement;

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Recent');
  });

  it('opens from whichever of its triggers is used and returns the focus there', async () => {
    const shared = TestBed.createComponent(SharedHostComponent);
    await shared.whenStable();
    const [ first ] = [ ...shared.nativeElement.querySelectorAll('button') ] as HTMLButtonElement[];

    first.click();
    await shared.whenStable();
    expect(inOverlay()).not.toBeNull();
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(activeText()).toBe('Rename');

    await press('Escape');
    expect(inOverlay()).toBeNull();
    expect(document.activeElement).toBe(first);
  });
});
