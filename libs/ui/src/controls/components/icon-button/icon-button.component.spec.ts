import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { IconButtonComponent } from './icon-button.component';

@Component({
  imports: [ IconButtonComponent, IconComponent ],
  template: `
    <button uiIconButton label="Fetch"><ui-icon name="repo-fetch" /></button>
    <button uiIconButton label="Show remote images" [pressed]="pressed()"><ui-icon name="eye" /></button>
  `
})
class HostComponent {
  readonly pressed = signal(false);
}

describe('IconButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const buttons = () => fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is named by its label', () => {
    const fetch = buttons()[0];

    expect(fetch.getAttribute('aria-label')).toBe('Fetch');
    expect(fetch.hasAttribute('title')).toBe(false);
    expect(fetch.hasAttribute('aria-describedby')).toBe(false);
    expect(fetch.getAttribute('type')).toBe('button');
  });

  it('shows its label as a tooltip on focus', () => {
    // jsdom decides `:focus-visible` from the last event, as browsers do.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    buttons()[0].focus();

    expect(document.querySelector('ui-tooltip')?.textContent?.trim()).toBe('Fetch');
  });

  it('is a toggle only when pressed is set', async () => {
    expect(buttons()[0].hasAttribute('aria-pressed')).toBe(false);
    expect(buttons()[1].getAttribute('aria-pressed')).toBe('false');

    fixture.componentInstance.pressed.set(true);
    await fixture.whenStable();

    expect(buttons()[1].getAttribute('aria-pressed')).toBe('true');
  });
});

@Component({
  imports: [ IconButtonComponent, IconComponent ],
  template: `
    <button uiIconButton label="Fetch" [busy]="busy()" [unavailable]="unavailable()" (click)="clicks = clicks + 1"><ui-icon name="repo-fetch" /></button>
    <button uiIconButton label="Push" unavailable (click)="clicks = clicks + 1"><ui-icon name="repo-push" /></button>
  `
})
class BusyHostComponent {
  readonly busy = signal(false);
  readonly unavailable = signal(false);
  clicks = 0;
}

describe('IconButtonComponent busy', () => {
  let fixture: ComponentFixture<BusyHostComponent>;

  const buttons = () => fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
  const setBusy = async (busy: boolean) => {
    fixture.componentInstance.busy.set(busy);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ BusyHostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(BusyHostComponent);
    await fixture.whenStable();
  });

  it('shows a spinner and keeps its name while busy', async () => {
    const [ pull ] = buttons();
    const name = () => pull.getAttribute('aria-label') ?? pull.textContent?.trim();
    const nameBefore = name();

    await setBusy(true);

    expect(pull.querySelector('ui-spinner')).not.toBeNull();
    expect((pull.querySelector('.icon') as HTMLElement).hidden).toBe(true);
    expect(pull.getAttribute('aria-disabled')).toBe('true');
    expect(pull.dataset['busy']).toBe('true');
    expect(name()).toBe(nameBefore);

    await setBusy(false);

    expect(pull.querySelector('ui-spinner')).toBeNull();
    expect(pull.hasAttribute('aria-disabled')).toBe(false);
  });

  it('keeps the focus when it becomes busy', async () => {
    const [ pull ] = buttons();
    pull.focus();

    await setBusy(true);

    expect(document.activeElement).toBe(pull);
  });

  it('stays unavailable when busy ends in the same change as it becomes unavailable', async () => {
    const [ pull ] = buttons();
    await setBusy(true);

    fixture.componentInstance.busy.set(false);
    fixture.componentInstance.unavailable.set(true);
    await fixture.whenStable();

    expect(pull.getAttribute('aria-disabled')).toBe('true');
  });

  it('stays unavailable when busy ends after it became unavailable', async () => {
    const [ pull ] = buttons();
    await setBusy(true);
    fixture.componentInstance.unavailable.set(true);
    await fixture.whenStable();

    await setBusy(false);

    expect(pull.getAttribute('aria-disabled')).toBe('true');
  });

  it('stays aria-disabled while busy when it becomes available', async () => {
    const [ pull ] = buttons();
    fixture.componentInstance.unavailable.set(true);
    await setBusy(true);

    fixture.componentInstance.unavailable.set(false);
    await fixture.whenStable();
    pull.click();

    expect(pull.getAttribute('aria-disabled')).toBe('true');
    expect(fixture.componentInstance.clicks).toBe(0);
  });

  it('swallows clicks while aria-disabled', async () => {
    const [ pull, push ] = buttons();

    await setBusy(true);
    pull.click();
    push.click();
    expect(fixture.componentInstance.clicks).toBe(0);

    await setBusy(false);
    pull.click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });
});
