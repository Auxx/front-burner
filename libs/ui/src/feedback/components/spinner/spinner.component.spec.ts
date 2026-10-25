import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpinnerComponent } from './spinner.component';

@Component({
  imports: [ SpinnerComponent ],
  template: `
    <ui-spinner label="Loading repositories" />
    <ui-spinner />
  `
})
class HostComponent {}

describe('SpinnerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const spinners = () => fixture.nativeElement.querySelectorAll('ui-spinner') as NodeListOf<HTMLElement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is a labelled, indeterminate progress bar when it has a label', () => {
    const spinner = spinners()[0];

    expect(spinner.getAttribute('role')).toBe('progressbar');
    expect(spinner.getAttribute('aria-label')).toBe('Loading repositories');
    expect(spinner.hasAttribute('aria-valuenow')).toBe(false);
    expect(spinner.hasAttribute('aria-hidden')).toBe(false);
  });

  it('is hidden from assistive technology without a label', () => {
    const spinner = spinners()[1];

    expect(spinner.getAttribute('aria-hidden')).toBe('true');
    expect(spinner.hasAttribute('role')).toBe(false);
  });
});
