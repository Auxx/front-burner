import { Component } from '@angular/core';
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
