import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DividerComponent } from './divider.component';

@Component({
  imports: [ DividerComponent ],
  template: `
    <ui-divider id="plain" />
    <ui-divider id="worded">or</ui-divider>
  `
})
class HostComponent {}

describe('DividerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const divider = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is a separator', () => {
    expect(divider('plain').getAttribute('role')).toBe('separator');
    expect(divider('worded').getAttribute('role')).toBe('separator');
  });

  it('shows its text between two lines', () => {
    const worded = divider('worded');
    expect(worded.querySelector('.text')?.textContent?.trim()).toBe('or');
    expect(worded.querySelectorAll('.line')).toHaveLength(2);
  });

  it('is one line without text', () => {
    const plain = divider('plain');
    expect(plain.querySelectorAll('.line')).toHaveLength(1);
    expect(plain.querySelector('.text')?.hasAttribute('hidden')).toBe(true);
  });
});
