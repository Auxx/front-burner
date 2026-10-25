import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { translocoTesting } from '../../../testing/transloco-testing';
import { LoginMethodStepComponent } from './login-method-step.component';

const KEY = 'web-feature-auth.LoginMethodStepComponent';

@Component({
  imports: [ LoginMethodStepComponent ],
  template: `<auth-login-method-step (chosen)="events.push('chosen')" (back)="events.push('back')" />`
})
class HostComponent {
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

  it('explains the step and offers both methods, OIDC disabled', () => {
    expect(element().textContent).toContain(`${KEY}.intro`);
    const radios = [ ...element().querySelectorAll<HTMLInputElement>('input[type="radio"]') ];
    expect(radios).toHaveLength(2);
    expect(radios[0]?.checked).toBe(true);
    expect(radios[1]?.disabled).toBe(true);
    expect(element().textContent).toContain(`${KEY}.oidcUnavailable`);
  });

  it('continues with username and password', () => {
    button('continue').click();
    expect(fixture.componentInstance.events).toEqual([ 'chosen' ]);
  });

  it('goes back', () => {
    button('back').click();
    expect(fixture.componentInstance.events).toEqual([ 'back' ]);
  });
});
