import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { LockedKeyBannerComponent } from './locked-key-banner.component';

const KEY = 'web-feature-repository-screen.LockedKeyBannerComponent';

describe('LockedKeyBannerComponent', () => {
  let fixture: ComponentFixture<LockedKeyBannerComponent>;
  let announce: ReturnType<typeof vi.fn>;

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...element().querySelectorAll<HTMLButtonElement>('button') ].find(found =>
      found.textContent?.trim() === text || found.getAttribute('aria-label') === text
    );

  beforeEach(async () => {
    announce = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [
        LockedKeyBannerComponent,
        translocoTesting({ [`${KEY}.message`]: '{{ name }} is locked. Unlock it to fetch, pull and push.' })
      ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    });
    fixture = TestBed.createComponent(LockedKeyBannerComponent);
    fixture.componentRef.setInput('keyName', 'laptop');
    await settle(fixture);
  });

  it('says which key is locked, and announces it once', async () => {
    expect(element().textContent).toContain('laptop is locked. Unlock it to fetch, pull and push.');
    expect(announce).toHaveBeenCalledOnce();

    fixture.componentRef.setInput('keyName', 'desktop');
    await settle(fixture);
    expect(announce).toHaveBeenCalledOnce();
  });

  it('offers Unlock', () => {
    let unlocks = 0;
    fixture.componentInstance.unlock.subscribe(() => unlocks++);

    button(`${KEY}.unlock`)?.click();

    expect(unlocks).toBe(1);
  });

  it('can be dismissed', () => {
    let dismissed = 0;
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);

    button(`${KEY}.dismiss`)?.click();

    expect(dismissed).toBe(1);
  });
});
