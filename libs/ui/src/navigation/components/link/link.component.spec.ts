import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LinkComponent } from './link.component';

@Component({
  imports: [ LinkComponent ],
  template: `
    <a uiLink
       href="/repositories">All repositories</a>
  `
})
class HostComponent {}

describe('LinkComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('keeps the link and its text as they are', () => {
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    expect(link.getAttribute('href')).toBe('/repositories');
    expect(link.textContent?.trim()).toBe('All repositories');
  });
});
