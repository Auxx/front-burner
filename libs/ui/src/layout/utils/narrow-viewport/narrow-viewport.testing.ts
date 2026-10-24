import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Provider } from '@angular/core';
import { BehaviorSubject, map, Observable } from 'rxjs';

/** A BreakpointObserver for unit tests, where jsdom has no `matchMedia`. */
export class FakeBreakpointObserver implements Pick<BreakpointObserver, 'isMatched' | 'observe'> {
  private readonly matches = new BehaviorSubject(false);

  /** Makes every observed query match, or none. */
  set(matches: boolean): void {
    this.matches.next(matches);
  }

  isMatched(): boolean {
    return this.matches.value;
  }

  observe(): Observable<BreakpointState> {
    return this.matches.pipe(map(matches => ({ matches, breakpoints: {} })));
  }
}

export function provideFakeBreakpointObserver(fake: FakeBreakpointObserver): Provider {
  return { provide: BreakpointObserver, useValue: fake };
}
