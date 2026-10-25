import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { translocoTesting } from '../../../testing/transloco-testing';
import { PasswordPolicyComponent } from './password-policy.component';

const KEY = 'web-feature-auth.PasswordPolicyComponent';

@Component({
  imports: [ PasswordPolicyComponent ],
  template: `<auth-password-policy [password]="password()" [email]="email()" />`
})
class HostComponent {
  readonly password = signal('');
  readonly email = signal('alice@example.com');
}

describe('PasswordPolicyComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  /** Each listed rule and whether it is met. */
  const rules = () =>
    Object.fromEntries(
      [ ...(fixture.nativeElement as HTMLElement).querySelectorAll('li') ].map(item => [
        item.dataset['rule'],
        item.dataset['met'] === 'true'
      ])
    );

  const type = async (password: string) => {
    fixture.componentInstance.password.set(password);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent, translocoTesting() ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('lists the rules before anything is typed', () => {
    expect(rules()).toEqual({ 'too-short': false, 'too-few-classes': false, 'equals-email': true });
  });

  it('marks the rules abc fails', async () => {
    await type('abc');
    expect(rules()).toEqual({ 'too-short': false, 'too-few-classes': false, 'equals-email': true });
  });

  it('marks every rule met for a good password', async () => {
    await type('abcdefghi1');
    expect(rules()).toEqual({ 'too-short': true, 'too-few-classes': true, 'equals-email': true });
  });

  it('lists control-character only while a password has one', async () => {
    await type('abcde\tfghi1');
    expect(rules()['control-character']).toBe(false);
    await type('abcdefghi1');
    expect(rules()).not.toHaveProperty('control-character');
  });

  it('lists too-long only while a password is too long', async () => {
    await type('a1'.repeat(129));
    expect(rules()['too-long']).toBe(false);
  });

  it('marks equals-email when the password is the email', async () => {
    await type('Alice@Example.com');
    expect(rules()['equals-email']).toBe(false);
  });

  it('says met or not met in words', async () => {
    await type('abc');
    const first = (fixture.nativeElement as HTMLElement).querySelector('li[data-rule="too-short"]');
    expect(first?.textContent).toContain(`${KEY}.rules.too-short`);
    expect(first?.textContent).toContain(`${KEY}.notMet`);
  });
});
