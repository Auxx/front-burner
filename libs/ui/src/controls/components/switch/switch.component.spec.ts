import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChoiceComponent } from '../choice/choice.component';
import { SwitchComponent } from './switch.component';

@Component({
  imports: [ ChoiceComponent, SwitchComponent ],
  template: `
    <label uiChoice>
      <input type="checkbox" uiSwitch [checked]="on()" (change)="on.set($any($event.target).checked)" />
      Use the default author
    </label>
  `
})
class HostComponent {
  readonly on = signal(false);
}

describe('SwitchComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is a switch', () => {
    expect(input().getAttribute('role')).toBe('switch');
    expect(input().type).toBe('checkbox');
  });

  it('turns on when activated', async () => {
    // jsdom does not activate a checkbox on Space, so it is clicked.
    input().click();
    await fixture.whenStable();

    expect(input().checked).toBe(true);
    expect(fixture.componentInstance.on()).toBe(true);
  });
});
