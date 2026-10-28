import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PageTitleService } from '@front-burner/web-core';

import { RouteAnnouncerComponent } from './route-announcer.component';

/** The announcer stays while the pages change, as in the shell layout. */
@Component({
  imports: [ RouterOutlet, RouteAnnouncerComponent ],
  template: '<router-outlet /><shell-route-announcer />'
})
class HostLayout {}

@Component({ template: '' })
class BlankPage {}

/** A page that knows its title as soon as it is created. */
@Component({ template: '' })
class EarlyTitlePage {
  constructor() {
    inject(PageTitleService).publish('handbook');
  }
}

describe('RouteAnnouncerComponent', () => {
  let harness: RouterTestingHarness;

  const region = () => (harness.fixture.nativeElement as HTMLElement).querySelector('[aria-live]') as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([ {
          path: '',
          component: HostLayout,
          children: [
            { path: '', component: BlankPage },
            { path: 'other', component: BlankPage },
            { path: 'own', data: { ownTitle: true }, component: BlankPage },
            { path: 'own/again', data: { ownTitle: true }, component: BlankPage },
            { path: 'own/early', data: { ownTitle: true }, component: EarlyTitlePage }
          ]
        } ])
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

  it('waits for the title of a page that sets its own, however long it takes', async () => {
    await TestBed.inject(Router).navigateByUrl('/own');
    await announced();
    expect(region().textContent?.trim()).toBe('');

    TestBed.inject(PageTitleService).publish('handbook');
    await harness.fixture.whenStable();

    expect(region().textContent?.trim()).toBe('handbook · Front Burner');
  });

  it('announces a title that the page set during the navigation', async () => {
    await TestBed.inject(Router).navigateByUrl('/own/early');
    await harness.fixture.whenStable();

    expect(region().textContent?.trim()).toBe('handbook · Front Burner');
  });

  it('does not reuse a title published for an earlier page', async () => {
    const router = TestBed.inject(Router);
    const pageTitle = TestBed.inject(PageTitleService);
    await router.navigateByUrl('/own');
    pageTitle.publish('handbook');
    await router.navigateByUrl('/other');
    TestBed.inject(Title).setTitle('Other · Front Burner');
    await announced();
    expect(region().textContent?.trim()).toBe('Other · Front Burner');

    await router.navigateByUrl('/own/again');
    await announced();

    expect(region().textContent?.trim()).toBe('Other · Front Burner');
  });
});
