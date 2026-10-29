import { MenuHarness, MenuItemHarness, type MenuItemHarnessFilters } from '@angular/aria/menu/testing';
import { HarnessLoader, HarnessPredicate } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal, viewChild } from '@angular/core';
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
  readonly trigger = viewChild.required(MenuTriggerDirective);
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
    @if (showFirst()) {
      <button [uiMenuTrigger]="menu.aria">First row</button>
    }
    <button [uiMenuTrigger]="menu.aria">Second row</button>
    @if (showThird()) {
      <button [uiMenuTrigger]="menu.aria">Third row</button>
    }
    <ui-menu #menu="uiMenu">
      <button uiMenuItem="rename">Rename</button>
    </ui-menu>
  `
})
class SharedHostComponent {
  readonly showFirst = signal(true);
  readonly showThird = signal(false);
}

@Component({
  imports: [ MenuComponent, MenuItemComponent, MenuTriggerDirective ],
  template: `
    @if (show()) {
      <button [uiMenuTrigger]="menu.aria">Row actions</button>
      <ui-menu #menu="uiMenu">
        <button uiMenuItem="rename">Rename</button>
      </ui-menu>
    }
  `
})
class ConditionalHostComponent {
  readonly show = signal(true);
}

@Component({
  imports: [ MenuComponent, MenuItemComponent, MenuTriggerDirective ],
  template: `
    <button [uiMenuTrigger]="menu.aria">Repositories</button>
    <ui-menu #menu="uiMenu">
      @if (loading()) {
        <button uiMenuItem="loading">Loading</button>
      }
      @for (name of names(); track name) {
        <a [uiMenuItem]="name" href="/{{ name }}">{{ name }}</a>
      }
      <a uiMenuItem="all" href="/repositories">All repositories</a>
    </ui-menu>
  `
})
class LoadingHostComponent {
  readonly loading = signal(false);
  readonly names = signal<string[]>([]);
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
      imports: [
        HostComponent,
        GroupHostComponent,
        SharedHostComponent,
        ConditionalHostComponent,
        LoadingHostComponent
      ]
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

  it('opens again from code after a choice closed it, on its first item', async () => {
    await open();
    const menu = await loader.getHarness(UiMenuHarness);
    const [ , pull ] = await menu.getItems();
    await pull.click();
    await fixture.whenStable();

    host.trigger().open();
    await fixture.whenStable();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(inOverlay()).not.toBeNull();
    expect(activeText()).toBe('Fetch');
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

  it('leaves nothing in the page when it is destroyed while open', async () => {
    const conditional = TestBed.createComponent(ConditionalHostComponent);
    await conditional.whenStable();
    const rowActions = conditional.nativeElement.querySelector('button') as HTMLButtonElement;

    rowActions.click();
    await conditional.whenStable();
    expect(inOverlay()).not.toBeNull();

    conditional.componentInstance.show.set(false);
    await conditional.whenStable();

    expect(document.querySelector('ui-menu')).toBeNull();
  });

  describe('shared between triggers', () => {
    let shared: ComponentFixture<SharedHostComponent>;
    const triggers = () =>
      ([ ...shared.nativeElement.querySelectorAll('button') ] as HTMLButtonElement[]).filter(b =>
        b.textContent?.includes('row')
      );
    const shareTrigger = (text: string) => triggers().find(b => b.textContent?.trim() === text) as HTMLButtonElement;
    const expandedStates = () => triggers().map(b => b.getAttribute('aria-expanded'));

    beforeEach(async () => {
      shared = TestBed.createComponent(SharedHostComponent);
      await shared.whenStable();
    });

    it('opens from a second trigger after the first', async () => {
      shareTrigger('First row').click();
      await shared.whenStable();
      await press('Escape');

      shareTrigger('Second row').click();
      await shared.whenStable();
      expect(inOverlay()).not.toBeNull();
      expect(expandedStates()).toEqual([ 'false', 'true' ]);

      await press('Escape');
      expect(inOverlay()).toBeNull();
      expect(document.activeElement).toBe(shareTrigger('Second row'));
    });

    it('moves next to a second trigger that claims it in the same task', async () => {
      const place = (button: HTMLButtonElement, top: number) =>
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
          { top, bottom: top + 20, left: 10, right: 110, width: 100, height: 20, x: 10, y: top } as DOMRect
        );
      place(shareTrigger('First row'), 100);
      place(shareTrigger('Second row'), 300);

      shareTrigger('First row').click();
      await shared.whenStable();
      const pane = () => document.querySelector('.cdk-overlay-pane') as HTMLElement;
      expect(pane().style.top).toBe('120px');

      // A touch tap fires focus and click in one task, with no change
      // detection in between.
      shareTrigger('Second row').focus();
      shareTrigger('Second row').click();
      await shared.whenStable();

      expect(expandedStates()).toEqual([ 'false', 'true' ]);
      expect(inOverlay()).not.toBeNull();
      expect(pane().style.top).toBe('320px');
    });

    it('stays open when another trigger is created', async () => {
      shareTrigger('First row').click();
      await shared.whenStable();

      shared.componentInstance.showThird.set(true);
      await shared.whenStable();

      expect(inOverlay()).not.toBeNull();
      expect(expandedStates()).toEqual([ 'true', 'false', 'false' ]);

      await press('Escape');
      expect(inOverlay()).toBeNull();
      expect(expandedStates()).toEqual([ 'false', 'false', 'false' ]);
      expect(document.activeElement).toBe(shareTrigger('First row'));

      shareTrigger('Third row').click();
      await shared.whenStable();
      expect(inOverlay()).not.toBeNull();
      expect(expandedStates()).toEqual([ 'false', 'false', 'true' ]);
    });

    it('closes when its trigger is removed', async () => {
      shareTrigger('First row').click();
      await shared.whenStable();

      shared.componentInstance.showFirst.set(false);
      await shared.whenStable();

      expect(inOverlay()).toBeNull();
      shareTrigger('Second row').click();
      await shared.whenStable();
      expect(inOverlay()).not.toBeNull();
    });
  });

  describe('with items that arrive while it is open', () => {
    let loading: ComponentFixture<LoadingHostComponent>;

    const opener = () => loading.nativeElement.querySelector('button') as HTMLButtonElement;
    const arrive = async (names: string[]) => {
      loading.componentInstance.loading.set(false);
      loading.componentInstance.names.set(names);
      await loading.whenStable();
    };

    beforeEach(async () => {
      loading = TestBed.createComponent(LoadingHostComponent);
      await loading.whenStable();
    });

    it('moves the focus to the new first item', async () => {
      opener().click();
      await loading.whenStable();
      expect(activeText()).toBe('All repositories');

      await arrive([ 'notes', 'blog' ]);

      expect(activeText()).toBe('notes');
      expect(opener().getAttribute('aria-expanded')).toBe('true');
    });

    it('moves the focus to the first item when the focused one goes', async () => {
      loading.componentInstance.loading.set(true);
      await loading.whenStable();
      opener().click();
      await loading.whenStable();
      expect(activeText()).toBe('Loading');

      await arrive([ 'notes' ]);

      expect(activeText()).toBe('notes');
      expect(opener().getAttribute('aria-expanded')).toBe('true');
    });

    it('leaves the focus where the user moved it', async () => {
      await arrive([ 'notes' ]);
      opener().click();
      await loading.whenStable();
      await press('ArrowDown');
      expect(activeText()).toBe('All repositories');

      await arrive([ 'notes', 'blog' ]);

      expect(activeText()).toBe('All repositories');
    });
  });
});
