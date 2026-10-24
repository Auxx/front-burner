import { ToolbarHarness, ToolbarWidgetHarness } from '@angular/aria/toolbar/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ActivityBarItemComponent } from '../activity-bar-item/activity-bar-item.component';
import { ActivityBarComponent } from './activity-bar.component';

// The Aria harnesses find `[ngToolbar]` and `[ngToolbarWidget]`, attributes
// that host directives do not add.
class ActivityBarHarness extends ToolbarHarness {
  static override hostSelector = 'ui-activity-bar';
}

class ActivityBarItemHarness extends ToolbarWidgetHarness {
  static override hostSelector = '[uiActivityBarItem]';
}

@Component({
  imports: [ ActivityBarComponent, ActivityBarItemComponent ],
  template: `
    <ui-activity-bar label="Side panel" [orientation]="orientation()" [(selected)]="selected">
      <button uiActivityBarItem="files" label="Files">F</button>
      <button uiActivityBarItem="changes" label="Changes">C</button>
      <button uiActivityBarItem="search" label="Search">S</button>
    </ui-activity-bar>
  `
})
class HostComponent {
  readonly orientation = signal<'horizontal' | 'vertical'>('vertical');
  readonly selected = signal<string | null>(null);
}

describe('ActivityBarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let loader: HarnessLoader;

  const button = (value: string) =>
    fixture.nativeElement.querySelector(`[uiActivityBarItem="${value}"]`) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  it('is a vertical toolbar with an accessible name', async () => {
    const toolbar = await loader.getHarness(ActivityBarHarness);
    const element: HTMLElement = fixture.nativeElement.querySelector('ui-activity-bar');

    expect(await toolbar.getOrientation()).toBe('vertical');
    expect(element.getAttribute('role')).toBe('toolbar');
    expect(element.getAttribute('aria-label')).toBe('Side panel');
  });

  it('is horizontal when the consumer says so', async () => {
    host.orientation.set('horizontal');
    await fixture.whenStable();

    expect(await (await loader.getHarness(ActivityBarHarness)).getOrientation()).toBe('horizontal');
  });

  it('selects an item on click and marks it pressed', async () => {
    const [ files, changes ] = await loader.getAllHarnesses(ActivityBarItemHarness);

    await files.click();

    expect(host.selected()).toBe('files');
    expect(await files.isSelected()).toBe(true);
    expect(await changes.isSelected()).toBe(false);
    expect(button('changes').getAttribute('aria-pressed')).toBe('false');
  });

  it('unselects the selected item when it is clicked again', async () => {
    const [ files ] = await loader.getAllHarnesses(ActivityBarItemHarness);

    await files.click();
    await files.click();

    expect(host.selected()).toBeNull();
    expect(await loader.getAllHarnesses(ActivityBarItemHarness.with({ selected: true }))).toEqual([]);
  });

  it('follows a selection made by the consumer', async () => {
    host.selected.set('search');
    await fixture.whenStable();

    expect(button('search').getAttribute('aria-pressed')).toBe('true');
  });

  it('names icon-only items', () => {
    const files = button('files');

    expect(files.getAttribute('aria-label')).toBe('Files');
    expect(files.getAttribute('title')).toBe('Files');
    expect(files.type).toBe('button');
  });

  it('is one tab stop', () => {
    const tabStops = [ 'files', 'changes', 'search' ].filter(value => button(value).tabIndex === 0);

    expect(tabStops.length).toBe(1);
  });
});
