import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from './button.component';

@Component({
  imports: [ ButtonComponent ],
  template: `
    <form (submit)="submits = submits + 1; $event.preventDefault()">
      <input aria-label="Name" />
      <button uiButton>Cancel</button>
      <button uiButton variant="primary" type="submit">Add repository</button>
      <button uiButton variant="danger" size="small" [disabled]="true">Remove</button>
    </form>
    <a uiButton href="/repositories/new">Add repository</a>
  `
})
class HostComponent {
  submits = 0;
}

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const button = (text: string) =>
    [ ...fixture.nativeElement.querySelectorAll('button') ].find(
      (element: HTMLButtonElement) => element.textContent?.trim() === text
    ) as HTMLButtonElement;
  const link = () => fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is a plain button unless asked to submit', () => {
    expect(button('Cancel').getAttribute('type')).toBe('button');
    expect(button('Add repository').getAttribute('type')).toBe('submit');
    expect(link().hasAttribute('type')).toBe(false);
  });

  it('does not submit the form from a plain button', () => {
    button('Cancel').click();
    expect(fixture.componentInstance.submits).toBe(0);

    button('Add repository').click();
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('has one submit button, so Enter in a field submits through it', () => {
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const submitButtons = [ ...form.querySelectorAll('button') ].filter(element => element.type === 'submit');

    expect(submitButtons).toEqual([ button('Add repository') ]);
  });

  it('exposes variant and size for styling', () => {
    expect(button('Add repository').dataset['variant']).toBe('primary');
    expect(button('Add repository').dataset['size']).toBe('default');
    expect(button('Remove').dataset['variant']).toBe('danger');
    expect(button('Remove').dataset['size']).toBe('small');
    expect(button('Cancel').dataset['variant']).toBe('secondary');
  });

  it('keeps the native disabled state', () => {
    button('Remove').click();

    expect(button('Remove').disabled).toBe(true);
    expect(fixture.componentInstance.submits).toBe(0);
  });
});

@Component({
  imports: [ ButtonComponent ],
  template: `
    <button uiButton [busy]="busy()" (click)="clicks = clicks + 1"><svg aria-hidden="true"></svg>Pull</button>
    <button uiButton aria-disabled="true" (click)="clicks = clicks + 1">Push</button>
  `
})
class BusyHostComponent {
  readonly busy = signal(false);
  clicks = 0;
}

describe('ButtonComponent busy', () => {
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
