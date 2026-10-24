import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppShellSideDirective } from './app-shell-side.directive';

@Component({
  imports: [ AppShellSideDirective ],
  template: `<aside uiAppShellSide resizeLabel="Resize side panel"></aside>`
})
class HostComponent {}

describe('AppShellSideDirective', () => {
  it('can take the focus from script', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('aside').getAttribute('tabindex')).toBe('-1');
  });
});
