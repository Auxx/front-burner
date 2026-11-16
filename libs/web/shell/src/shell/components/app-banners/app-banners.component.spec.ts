import { LiveAnnouncer } from '@angular/cdk/a11y';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { OnlineStatusService, VersionCheckService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AppBannersComponent } from './app-banners.component';

const KEY = 'web-shell.AppBannersComponent';

describe('AppBannersComponent', () => {
  let fixture: ComponentFixture<AppBannersComponent>;
  let newVersion: ReturnType<typeof signal<boolean>>;
  let online: ReturnType<typeof signal<boolean>>;
  let reload: ReturnType<typeof vi.fn>;
  let announce: ReturnType<typeof vi.fn>;

  const element = () => fixture.nativeElement as HTMLElement;
  const banners = () => [ ...element().querySelectorAll('ui-inline-banner') ].map(banner => banner.textContent?.trim());
  const reloadButton = () =>
    [ ...element().querySelectorAll('button') ].find(button => button.textContent?.trim() === `${KEY}.reload`);

  beforeEach(async () => {
    newVersion = signal(false);
    online = signal(true);
    reload = vi.fn(() => Promise.resolve());
    announce = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [ AppBannersComponent, translocoTesting() ],
      providers: [
        { provide: VersionCheckService, useValue: { newVersion, reload } },
        { provide: OnlineStatusService, useValue: { online } },
        { provide: LiveAnnouncer, useValue: { announce } }
      ]
    });
    fixture = TestBed.createComponent(AppBannersComponent);
    await settle(fixture);
  });

  it('shows nothing while all is well', () => {
    expect(banners()).toEqual([]);
  });

  it('shows the new-version banner on a version change, and announces it once', async () => {
    newVersion.set(true);
    await settle(fixture);

    expect(banners()).toEqual([ expect.stringContaining(`${KEY}.newVersion`) ]);
    expect(reloadButton()).toBeDefined();
    expect(announce).toHaveBeenCalledOnce();
  });

  it('cannot be dismissed', async () => {
    newVersion.set(true);
    await settle(fixture);

    expect(element().querySelectorAll('button')).toHaveLength(1);
  });

  it('reloads through the version check, which saves first', async () => {
    newVersion.set(true);
    await settle(fixture);

    reloadButton()?.click();
    await settle(fixture);

    expect(reload).toHaveBeenCalledOnce();
    expect(reloadButton()?.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the offline banner while offline, and hides it when back', async () => {
    online.set(false);
    await settle(fixture);
    expect(banners()).toEqual([ `${KEY}.offline` ]);

    online.set(true);
    await settle(fixture);
    expect(banners()).toEqual([]);
  });

  it('shows both banners one above the other', async () => {
    newVersion.set(true);
    online.set(false);
    await settle(fixture);

    expect(banners()).toEqual([ expect.stringContaining(`${KEY}.newVersion`), `${KEY}.offline` ]);
  });
});
