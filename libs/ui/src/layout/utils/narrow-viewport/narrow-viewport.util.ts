import { BreakpointObserver } from '@angular/cdk/layout';
import { inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { NARROW_VIEWPORT } from '../../models/viewport.model';

/** Whether the page uses its narrow layout. Call in an injection context. */
export function injectNarrowViewport(): Signal<boolean> {
  const breakpoints = inject(BreakpointObserver);
  return toSignal(breakpoints.observe(NARROW_VIEWPORT).pipe(map(state => state.matches)), {
    initialValue: breakpoints.isMatched(NARROW_VIEWPORT)
  });
}
