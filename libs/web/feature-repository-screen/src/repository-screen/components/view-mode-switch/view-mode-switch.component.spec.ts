import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { TabContentDirective, TabGroupDirective, TabPanelDirective } from '@front-burner/ui';
import { CurrentUserService } from '@front-burner/web-core';
import { BehaviorSubject, map } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { ViewModeService } from '../../services/view-mode/view-mode.service';
import { ViewModeSwitchComponent } from './view-mode-switch.component';

const K = 'web-feature-repository-screen.ViewModeSwitchComponent';

@Component({
  imports: [ ViewModeSwitchComponent, TabGroupDirective, TabPanelDirective, TabContentDirective ],
  template: `
    <div uiTabGroup>
      <rs-view-mode-switch />
      <div uiTabPanel="edit"><ng-template uiTabContent>The editor</ng-template></div>
      <div uiTabPanel="preview"><ng-template uiTabContent>The preview</ng-template></div>
    </div>
  `
})
class HostComponent {}

describe('ViewModeSwitchComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let narrow: BehaviorSubject<boolean>;

  const element = () => fixture.nativeElement as HTMLElement;
  const viewMode = () => TestBed.inject(ViewModeService);

  async function create(isNarrow: boolean): Promise<void> {
    narrow = new BehaviorSubject(isNarrow);
    TestBed.configureTestingModule({
      imports: [
        HostComponent,
        translocoTesting({
          [`${K}.label`]: 'View',
          [`${K}.split`]: 'Split',
          [`${K}.edit`]: 'Edit',
          [`${K}.preview`]: 'Preview'
        })
      ],
      providers: [
        ViewModeService,
        { provide: CurrentUserService, useValue: { user: signal<CurrentUser | undefined>(undefined) } },
        {
          provide: BreakpointObserver,
          useValue: {
            isMatched: () => narrow.value,
            observe: () => narrow.pipe(map(matches => ({ matches, breakpoints: {} })))
          }
        }
      ]
    });
    fixture = TestBed.createComponent(HostComponent);
    await settle(fixture);
  }

  it('offers Split, Edit and Preview on wide screens', async () => {
    await create(false);

    const group = element().querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('View');
    const radios = Array.from(element().querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map(radio => radio.closest('label')?.textContent?.trim())).toEqual([ 'Split', 'Edit', 'Preview' ]);
    expect(radios[0].checked).toBe(true);

    radios[2].click();
    await settle(fixture);

    expect(viewMode().mode()).toBe('preview');
  });

  it('shows Edit and Preview tabs on narrow screens, each controlling its pane', async () => {
    await create(true);

    const tabs = Array.from(element().querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map(tab => tab.textContent?.trim())).toEqual([ 'Edit', 'Preview' ]);
    expect(element().querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('View');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    const panels = Array.from(element().querySelectorAll('[role="tabpanel"]'));
    expect(tabs.map(tab => tab.getAttribute('aria-controls'))).toEqual(panels.map(panel => panel.id));

    tabs[1].click();
    await settle(fixture);

    expect(viewMode().mode()).toBe('preview');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('follows the mode when it changes elsewhere', async () => {
    await create(true);

    viewMode().set('preview');
    await settle(fixture);

    const preview = element().querySelector('[role="tab"]:last-of-type');
    expect(preview?.getAttribute('aria-selected')).toBe('true');
  });
});
