import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InputComponent } from './input.component';

@Component({
  imports: [ InputComponent ],
  template: '<input uiInput aria-label="One" /><input uiInput aria-label="Two" />'
})
class HostComponent {
}

describe('InputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const elements = () => [ ...fixture.nativeElement.querySelectorAll('input') ] as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('has a unique id', () => {
    const [ one, two ] = elements();

    expect(one.id).not.toBe('');
    expect(one.id).not.toBe(two.id);
  });

  it('focuses its element', () => {
    const control = fixture.debugElement.children[1].injector.get(InputComponent);

    control.focus();

    expect(document.activeElement).toBe(elements()[1]);
  });
});
