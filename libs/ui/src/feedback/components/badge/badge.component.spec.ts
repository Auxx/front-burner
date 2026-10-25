import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BadgeComponent } from './badge.component';

@Component({
  imports: [ BadgeComponent ],
  template: `
    <span uiBadge status="danger">Clone failed</span>
    <span uiBadge>Cloning</span>
  `
})
class HostComponent {}

describe('BadgeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const badges = () => fixture.nativeElement.querySelectorAll('span[uiBadge]') as NodeListOf<HTMLElement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('shows its text with a status for styling', () => {
    const [ failed, cloning ] = badges();

    expect(failed.dataset['status']).toBe('danger');
    expect(failed.textContent?.trim()).toBe('Clone failed');
    expect(cloning.dataset['status']).toBe('neutral');
    expect(failed.hasAttribute('role')).toBe(false);
    expect(failed.hasAttribute('aria-live')).toBe(false);
  });
});
