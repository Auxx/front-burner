import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { BrandLinkComponent } from './brand-link.component';

const KEY = 'web-shell.BrandLinkComponent';

@Component({ imports: [ BrandLinkComponent ], template: '<shell-brand-link [compact]="compact()" />' })
class HostPage {
  readonly compact = signal(false);
}

describe('BrandLinkComponent', () => {
  let harness: RouterTestingHarness;

  const link = () => harness.routeNativeElement?.querySelector('shell-brand-link a') as HTMLAnchorElement;
  /** The link's accessible name: its `aria-label`, or else its text. */
  const name = () => link().getAttribute('aria-label') ?? link().textContent?.trim();

  async function open(url: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [ provideRouter([ { path: '', component: HostPage }, { path: 'other', component: HostPage } ]) ]
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle(harness.fixture);
  }

  it('links to the dashboard and keeps its name when compact', async () => {
    await open('/other');

    expect(link().getAttribute('href')).toBe('/');
    expect(link().querySelector('ui-icon[name="flame"]')).not.toBeNull();
    expect(name()).toBe('Front Burner');

    (harness.routeDebugElement?.componentInstance as HostPage).compact.set(true);
    await settle(harness.fixture);

    expect(link().getAttribute('href')).toBe('/');
    expect(link().querySelector('ui-icon[name="flame"]')).not.toBeNull();
    expect(link().textContent?.trim()).toBe('');
    expect(name()).toBe(`${KEY}.dashboard`);
  });

  it('marks the dashboard as the current page only on the dashboard', async () => {
    await open('/');
    expect(link().getAttribute('aria-current')).toBe('page');

    await harness.navigateByUrl('/other');
    await settle(harness.fixture);
    expect(link().hasAttribute('aria-current')).toBe(false);
  });
});
