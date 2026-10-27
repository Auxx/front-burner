import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { RouteAnnouncerComponent } from './route-announcer.component';

@Component({ imports: [ RouteAnnouncerComponent ], template: '<shell-route-announcer />' })
class HostPage {}

describe('RouteAnnouncerComponent', () => {
  let harness: RouterTestingHarness;

  const region = () => (harness.fixture.nativeElement as HTMLElement).querySelector('[aria-live]') as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: HostPage },
          { path: 'other', component: HostPage }
        ])
      ]
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
  });

  /** Waits for the announcement, which follows the title strategy. */
  const announced = () => new Promise(resolve => setTimeout(resolve, 200)).then(() => harness.fixture.whenStable());

  it('is a polite live region', () => {
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().textContent?.trim()).toBe('');
  });

  it('announces the title of the new page', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/other');
    TestBed.inject(Title).setTitle('Other · Front Burner');
    await announced();

    expect(region().textContent?.trim()).toBe('Other · Front Burner');
  });
});
