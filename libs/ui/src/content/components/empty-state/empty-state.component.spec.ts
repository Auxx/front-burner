import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { type IconName } from '../../models/icon-name.model';
import { EmptyStateActionsComponent } from '../empty-state-actions/empty-state-actions.component';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  imports: [ ButtonComponent, EmptyStateActionsComponent, EmptyStateComponent ],
  template: `
    <ui-empty-state [icon]="icon()" [heading]="heading()" [headingLevel]="headingLevel()">
      Choose a file from the tree, or create one
      <div uiEmptyStateActions><button uiButton>New file</button></div>
    </ui-empty-state>
  `
})
class HostComponent {
  readonly icon = signal<IconName | undefined>(undefined);
  readonly heading = signal<string | undefined>(undefined);
  readonly headingLevel = signal<2 | 3 | 4>(2);
}

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const state = () => fixture.nativeElement.querySelector('ui-empty-state') as HTMLElement;
  const set = async (change: (host: HostComponent) => void) => {
    change(fixture.componentInstance);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('shows its message and actions without a heading', () => {
    expect(state().querySelector('h2, h3, h4')).toBeNull();
    expect(state().querySelector('ui-icon')).toBeNull();
    expect(state().querySelector('.message')?.textContent?.trim()).toBe('Choose a file from the tree, or create one');
    expect(state().querySelector('[uiEmptyStateActions] button')?.textContent).toBe('New file');
  });

  it('renders the heading at the level it is given', async () => {
    await set(host => host.heading.set('Add your first repository'));

    expect(state().querySelector('h2')?.textContent?.trim()).toBe('Add your first repository');

    await set(host => host.headingLevel.set(3));

    expect(state().querySelector('h2')).toBeNull();
    expect(state().querySelectorAll('h3').length).toBe(1);
    expect(state().querySelector('h3')?.textContent?.trim()).toBe('Add your first repository');
  });

  it('shows a decorative icon', async () => {
    await set(host => host.icon.set('repo'));

    const icon = state().querySelector('ui-icon') as HTMLElement;
    expect(icon.querySelector('use')?.getAttribute('href')).toMatch(/#repo$/);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
