import { TabHarness, type TabHarnessFilters, TabsHarness } from '@angular/aria/tabs/testing';
import { Dir } from '@angular/cdk/bidi';
import { HarnessLoader, HarnessPredicate } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabGroupDirective } from '../../directives/tab-group/tab-group.directive';
import { TabPanelDirective } from '../../directives/tab-panel/tab-panel.directive';
import { TabComponent } from '../tab/tab.component';
import { TabStripComponent } from './tab-strip.component';

// The Aria harnesses find `[ngTabs]` and `[ngTab]`, attributes that host
// directives do not add. `TabsHarness` also builds its tabs from the base
// `TabHarness`, so it needs `getTabs` overridden to find ours.
class UiTabHarness extends TabHarness {
  static override hostSelector = '[uiTab]';

  static override with(options: TabHarnessFilters = {}): HarnessPredicate<UiTabHarness> {
    return new HarnessPredicate(UiTabHarness, options)
      .addOption('title', options.title, (harness, title) => HarnessPredicate.stringMatches(harness.getTitle(), title))
      .addOption('selected', options.selected, async (harness, selected) => (await harness.isSelected()) === selected)
      .addOption('disabled', options.disabled, async (harness, disabled) => (await harness.isDisabled()) === disabled);
  }
}

class TabGroupHarness extends TabsHarness {
  static override hostSelector = '[uiTabGroup]';

  override async getTabs(filters: TabHarnessFilters = {}): Promise<UiTabHarness[]> {
    return await this.locatorForAll(UiTabHarness.with(filters))();
  }
}

@Component({
  imports: [ Dir, TabGroupDirective, TabStripComponent, TabComponent, TabPanelDirective ],
  template: `
    <div uiTabGroup [dir]="direction()">
      <ui-tab-strip label="Left pane" [(selected)]="selected">
        <button uiTab="files">Files</button>
        <button uiTab="changes">Changes (3)</button>
      </ui-tab-strip>
      <div uiTabPanel="files"><input aria-label="Probe" /></div>
      <div uiTabPanel="changes">No changes</div>
    </div>
  `
})
class HostComponent {
  readonly selected = signal<string | undefined>('files');
  readonly direction = signal<'ltr' | 'rtl'>('ltr');
}

describe('TabStripComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let loader: HarnessLoader;

  const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement;
  const tab = (value: string) => el(`[uiTab="${value}"]`) as HTMLButtonElement;
  const panel = (value: string) => el(`[uiTabPanel="${value}"]`);

  const press = async (element: HTMLElement, key: string) => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  it('is a labelled tab list of buttons', () => {
    const strip = el('ui-tab-strip');

    expect(strip.getAttribute('role')).toBe('tablist');
    expect(strip.getAttribute('aria-label')).toBe('Left pane');
    for (const value of [ 'files', 'changes' ]) {
      expect(tab(value).getAttribute('role')).toBe('tab');
      expect(tab(value).type).toBe('button');
    }
  });

  it('shows the selected tab\'s panel only', async () => {
    const tabs = await loader.getHarness(TabGroupHarness);

    expect(await (await tabs.getSelectedTab())!.getTitle()).toBe('Files');
    expect(panel('files').hidden).toBe(false);
    expect(panel('changes').hidden).toBe(true);
  });

  it('links each tab and its panel', () => {
    for (const value of [ 'files', 'changes' ]) {
      expect(tab(value).getAttribute('aria-controls')).toBe(panel(value).id);
      expect(panel(value).getAttribute('role')).toBe('tabpanel');
      expect(panel(value).getAttribute('aria-labelledby')).toBe(tab(value).id);
    }
  });

  it('selects on click and updates the model', async () => {
    const changes = await loader.getHarness(UiTabHarness.with({ title: /Changes/ }));

    await changes.select();

    expect(host.selected()).toBe('changes');
    expect(await changes.isSelected()).toBe(true);
    expect(panel('changes').hidden).toBe(false);
    expect(panel('files').hidden).toBe(true);
  });

  it('selects with the arrow keys', async () => {
    await press(tab('files'), 'ArrowRight');

    expect(host.selected()).toBe('changes');
    expect(document.activeElement).toBe(tab('changes'));
  });

  it('reverses the arrow keys in right-to-left', async () => {
    host.direction.set('rtl');
    await fixture.whenStable();

    await press(tab('files'), 'ArrowLeft');

    expect(host.selected()).toBe('changes');
  });

  it('is one tab stop', () => {
    const tabStops = [ 'files', 'changes' ].filter(value => tab(value).tabIndex === 0);

    expect(tabStops.length).toBe(1);
  });

  it('keeps a hidden panel\'s content', async () => {
    const probe = el('input');

    host.selected.set('changes');
    await fixture.whenStable();
    expect(panel('files').hidden).toBe(true);

    host.selected.set('files');
    await fixture.whenStable();

    expect(el('input')).toBe(probe);
    expect(panel('files').hidden).toBe(false);
  });

  it('selects the first tab when the selected value is missing or unknown', async () => {
    host.selected.set(undefined);
    await fixture.whenStable();
    expect(panel('files').hidden).toBe(false);
    expect(panel('changes').hidden).toBe(true);

    host.selected.set('changes');
    await fixture.whenStable();
    host.selected.set('preview');
    await fixture.whenStable();
    expect(panel('files').hidden).toBe(false);
    expect(panel('changes').hidden).toBe(true);
  });
});
