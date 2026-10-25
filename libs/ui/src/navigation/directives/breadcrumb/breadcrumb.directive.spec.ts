import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BreadcrumbDirective } from './breadcrumb.directive';

@Component({
  imports: [ BreadcrumbDirective ],
  template: `<span *uiBreadcrumb>Settings</span>`
})
class HostComponent {
  readonly breadcrumb = viewChild.required(BreadcrumbDirective);
}

describe('BreadcrumbDirective', () => {
  it('exposes the template of its item', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.breadcrumb().template).toBeTruthy();
  });
});
