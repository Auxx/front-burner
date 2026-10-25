import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconButtonComponent } from './icon-button.component';

@Component({
  imports: [ IconButtonComponent ],
  template: `
    <button uiIconButton label="Fetch"><svg aria-hidden="true"></svg></button>
    <button uiIconButton label="Show remote images" [pressed]="pressed()"><svg aria-hidden="true"></svg></button>
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
  imports: [ IconButtonComponent ],
  template: `
    <button uiIconButton label="Fetch" [busy]="busy()" (click)="clicks = clicks + 1"><svg aria-hidden="true"></svg></button>
    <button uiIconButton label="Push" aria-disabled="true" (click)="clicks = clicks + 1"><svg aria-hidden="true"></svg></button>
  `
})
class BusyHostComponent {
  readonly busy = signal(false);
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
