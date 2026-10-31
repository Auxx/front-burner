import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DividerComponent } from './divider.component';

@Component({
  imports: [ DividerComponent ],
  template: `
    <ui-divider id="plain" />
    <ui-divider id="worded">or</ui-divider>
    <ui-divider id="late">{{ label() }}</ui-divider>
  `
})
class HostComponent {
  readonly label = signal('');
}

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
    expect(worded.querySelector('.text')?.matches(':empty')).toBe(false);
  });

  it('hides the text and the second line when nothing is projected', () => {
    const plain = divider('plain');
    expect(plain.querySelector('.text')?.matches(':empty')).toBe(true);
    expect(plain.querySelectorAll('.text:empty + .line')).toHaveLength(1);
  });

  it('shows text that arrives after the first render', async () => {
    const late = divider('late');
    // An empty text node: jsdom's :empty differs from browsers', so the story checks that in a browser.
    expect(late.querySelector('.text')?.textContent).toBe('');
    expect(late.querySelectorAll('.line')).toHaveLength(2);
    fixture.componentInstance.label.set('or');
    await fixture.whenStable();
    expect(late.querySelector('.text')?.matches(':empty')).toBe(false);
    expect(late.querySelector('.text')?.textContent).toBe('or');
    expect(late.querySelectorAll('.line')).toHaveLength(2);
  });
});
