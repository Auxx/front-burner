import { TestBed } from '@angular/core/testing';

import { FakeBreakpointObserver, provideFakeBreakpointObserver } from './narrow-viewport.testing';
import { injectNarrowViewport } from './narrow-viewport.util';

describe('injectNarrowViewport', () => {
  let breakpoints: FakeBreakpointObserver;

  beforeEach(() => {
    breakpoints = new FakeBreakpointObserver();
    TestBed.configureTestingModule({ providers: [ provideFakeBreakpointObserver(breakpoints) ] });
  });

  it('starts with the current match', () => {
    breakpoints.set(true);

    const narrow = TestBed.runInInjectionContext(() => injectNarrowViewport());

    expect(narrow()).toBe(true);
  });

  it('follows the viewport', () => {
    const narrow = TestBed.runInInjectionContext(() => injectNarrowViewport());
    expect(narrow()).toBe(false);

    breakpoints.set(true);
    expect(narrow()).toBe(true);
  });
});
