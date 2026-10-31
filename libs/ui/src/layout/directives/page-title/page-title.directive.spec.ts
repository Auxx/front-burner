import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PageTitleDirective } from './page-title.directive';

@Component({
  imports: [ PageTitleDirective ],
  template: '<h1 uiPageTitle>Dashboard</h1>'
})
class HostComponent {}

describe('PageTitleDirective', () => {
  it('lets the heading take the focus without adding a tab stop', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('h1').getAttribute('tabindex')).toBe('-1');
  });
});
