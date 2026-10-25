import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField } from '@angular/forms/signals';

import { PasswordRevealDirective } from '../../directives/password-reveal/password-reveal.directive';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { InputComponent } from '../input/input.component';
import { TextareaComponent } from '../textarea/textarea.component';
import { FieldComponent } from './field.component';

@Component({
  imports: [
    FieldComponent,
    FormField,
    IconButtonComponent,
    InputComponent,
    PasswordRevealDirective,
    TextareaComponent
  ],
  template: `
    <form (submit)="submits = submits + 1; $event.preventDefault()">
      <ui-field label="Remote URL" hint="HTTPS or SSH" [error]="error()">
        <input uiInput [formField]="model.url" />
      </ui-field>
      <ui-field label="Password or token">
        <input uiInput #secret type="password" value="s3cret" />
        <button uiIconButton [uiPasswordReveal]="secret" label="Show password"><svg aria-hidden="true"></svg></button>
      </ui-field>
      <ui-field label="Private key">
        <textarea uiTextarea code rows="6"></textarea>
      </ui-field>
      <ui-field label="Branch name">
        <input uiInput id="branch-name" />
      </ui-field>
    </form>
  `
})
class HostComponent {
  submits = 0;
  readonly model = form(signal({ url: '' }));
  readonly error = signal<string | undefined>(undefined);
}

describe('FieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const field = (index: number) => fixture.nativeElement.querySelectorAll('ui-field')[index] as HTMLElement;
  const label = (index: number) => field(index).querySelector('label') as HTMLLabelElement;
  const url = () => field(0).querySelector('input') as HTMLInputElement;
  const secret = () => field(1).querySelector('input') as HTMLInputElement;
  const reveal = () => field(1).querySelector('button') as HTMLButtonElement;
  const byId = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('labels its control', () => {
    expect(url().id).not.toBe('');
    expect(label(0).htmlFor).toBe(url().id);
    expect(url().getAttribute('aria-labelledby')).toBe(label(0).id);
    expect(label(0).textContent?.trim()).toBe('Remote URL');
    // The browser focuses a natively labelled control on a label click; jsdom
    // does not, so the association is checked instead.
    expect(label(0).control).toBe(url());
  });

  it('describes its control with the hint, then the error', async () => {
    const [ hintId ] = url().getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(byId(hintId)?.textContent?.trim()).toBe('HTTPS or SSH');
    expect(url().getAttribute('aria-describedby')).toBe(hintId);
    expect(url().hasAttribute('aria-invalid')).toBe(false);

    host.error.set('Use an HTTPS or SSH URL');
    await fixture.whenStable();

    const ids = url().getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(hintId);
    expect(byId(ids[1])?.textContent?.trim()).toBe('Use an HTTPS or SSH URL');
    expect(url().getAttribute('aria-invalid')).toBe('true');

    host.error.set(undefined);
    await fixture.whenStable();

    expect(url().hasAttribute('aria-invalid')).toBe(false);
    expect(url().getAttribute('aria-describedby')).toBe(hintId);
    expect(field(0).textContent).not.toContain('Use an HTTPS or SSH URL');
  });

  it('describes nothing without a hint or an error', () => {
    expect(secret().hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps a consumer id', () => {
    expect(label(3).htmlFor).toBe('branch-name');
    expect(byId('branch-name')?.tagName).toBe('INPUT');
  });

  it('binds to a Signal Forms field', async () => {
    url().value = 'https://github.com/a/b';
    url().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(host.model.url().value()).toBe('https://github.com/a/b');
  });

  it('reveals and hides a password without losing it', async () => {
    expect(reveal().getAttribute('aria-pressed')).toBe('false');
    expect(reveal().getAttribute('aria-controls')).toBe(secret().id);

    reveal().click();
    await fixture.whenStable();

    expect(secret().type).toBe('text');
    expect(secret().value).toBe('s3cret');
    expect(reveal().getAttribute('aria-pressed')).toBe('true');
    expect(host.submits).toBe(0);

    reveal().click();
    await fixture.whenStable();

    expect(secret().type).toBe('password');
    expect(reveal().getAttribute('aria-pressed')).toBe('false');
  });

  it('marks code fields', () => {
    expect(field(2).querySelector('textarea')?.dataset['code']).toBe('true');
    expect(url().hasAttribute('data-code')).toBe(false);
  });
});
