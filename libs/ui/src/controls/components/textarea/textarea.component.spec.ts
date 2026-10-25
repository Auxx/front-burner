import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TextareaComponent } from './textarea.component';

@Component({
  imports: [ TextareaComponent ],
  template: '<textarea uiTextarea aria-label="One"></textarea><textarea uiTextarea aria-label="Two"></textarea>'
})
class HostComponent {
}

describe('TextareaComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const elements = () => [ ...fixture.nativeElement.querySelectorAll('textarea') ] as HTMLElement[];

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
    const control = fixture.debugElement.children[1].injector.get(TextareaComponent);

    control.focus();

    expect(document.activeElement).toBe(elements()[1]);
  });
});
