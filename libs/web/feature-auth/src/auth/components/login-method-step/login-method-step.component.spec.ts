import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { translocoTesting } from '../../../testing/transloco-testing';
import { LoginMethodStepComponent } from './login-method-step.component';

const KEY = 'web-feature-auth.LoginMethodStepComponent';

@Component({
  imports: [ LoginMethodStepComponent ],
  template: `<auth-login-method-step
    [initial]="initial()"
    (chosen)="events.push($event)"
    (back)="events.push('back')"
  />`
})
class HostComponent {
  readonly initial = signal<'password' | 'oidc'>('password');
  readonly events: string[] = [];
}

describe('LoginMethodStepComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (key: string) =>
    [ ...element().querySelectorAll('button') ].find(b =>
      b.textContent?.includes(`${KEY}.${key}`)
    ) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent, translocoTesting() ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  const radios = () => [ ...element().querySelectorAll<HTMLInputElement>('input[type="radio"]') ];

  it('explains the step and offers both methods', () => {
    expect(element().textContent).toContain(`${KEY}.intro`);
    expect(radios()).toHaveLength(2);
    expect(radios()[0]?.checked).toBe(true);
  });

  it('offers OIDC', async () => {
    expect(radios()[1]?.disabled).toBe(false);
    radios()[1]?.click();
    await fixture.whenStable();
    button('continue').click();
    expect(fixture.componentInstance.events).toEqual([ 'oidc' ]);
  });

  it('preselects OIDC while pending', async () => {
    fixture.componentInstance.initial.set('oidc');
    await fixture.whenStable();
    expect(radios()[1]?.checked).toBe(true);
    button('continue').click();
    expect(fixture.componentInstance.events).toEqual([ 'oidc' ]);
  });

  it('continues with username and password', () => {
    button('continue').click();
    expect(fixture.componentInstance.events).toEqual([ 'password' ]);
  });

  it('goes back', () => {
    button('back').click();
    expect(fixture.componentInstance.events).toEqual([ 'back' ]);
  });
});
