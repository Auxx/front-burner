import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import type { RemovalKey, RemovalReport } from '../../pipeline/collect-removals';
import { RemovalNoticeComponent } from './removal-notice.component';

const PREFIX = 'web-markdown.RemovalNoticeComponent';

@Component({
  imports: [ RemovalNoticeComponent ],
  template: `<md-removal-notice [removals]="removals()" [(hidden)]="hidden" />`
})
class HostComponent {
  readonly removals = signal<RemovalReport>(new Map());
  readonly hidden = signal(false);
}

describe('RemovalNoticeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              [`${PREFIX}.message`]: 'Some HTML isn\'t shown in the preview.',
              [`${PREFIX}.details`]: 'Details',
              [`${PREFIX}.hide`]: 'Hide',
              [`${PREFIX}.kinds.tag`]: '× {{ count }}',
              [`${PREFIX}.kinds.attribute`]: 'attribute × {{ count }}',
              [`${PREFIX}.kinds.address`]: 'address × {{ count }}'
            }
          },
          preloadLangs: true,
          translocoConfig: { availableLangs: [ 'en' ], defaultLang: 'en' }
        })
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  async function show(removals: [ RemovalKey, number ][]): Promise<void> {
    host.removals.set(new Map(removals));
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string) =>
    Array.from(element().querySelectorAll('button')).find(found => found.textContent?.trim() === label);
  const items = () =>
    Array.from(element().querySelectorAll('li'), item => item.textContent?.replace(/\s+/g, ' ').trim());

  it('AC-EDIT-002.13: says HTML was removed and lists it by count', async () => {
    await show([ [ 'tag:iframe', 2 ], [ 'attribute:style', 5 ], [ 'address:javascript', 1 ] ]);

    expect(text()).toContain('Some HTML isn\'t shown in the preview.');
    const details = button('Details');
    const list = () => element().querySelector(`#${details?.getAttribute('aria-controls')}`) as HTMLElement | null;
    expect(details?.getAttribute('aria-expanded')).toBe('false');
    expect(list()?.tagName).toBe('UL');
    expect(list()?.hidden).toBe(true);

    details?.click();
    await fixture.whenStable();

    expect(details?.getAttribute('aria-expanded')).toBe('true');
    expect(list()?.hidden).toBe(false);
    expect(items()).toEqual([ 'style attribute × 5', '<iframe> × 2', 'javascript: address × 1' ]);
  });

  it('goes away when nothing is removed', async () => {
    await show([ [ 'tag:script', 1 ] ]);
    expect(text()).not.toBe('');

    await show([]);

    expect(text()).toBe('');
  });

  it('shows nothing for comments only', async () => {
    // Comments never reach the report (SH-10): a file with only comments removed reports nothing.
    await show([]);

    expect(element().querySelector('ui-inline-banner')).toBeNull();
  });

  it('AC-EDIT-002.14: hides until another file is opened', async () => {
    await show([ [ 'tag:script', 1 ] ]);

    button('Hide')?.click();
    await fixture.whenStable();

    expect(host.hidden()).toBe(true);
    expect(text()).toBe('');
    host.hidden.set(false);
    await fixture.whenStable();
    expect(text()).toContain('Some HTML');
  });

  it('stays hidden while typing after Hide', async () => {
    await show([ [ 'tag:script', 1 ] ]);
    button('Hide')?.click();
    await fixture.whenStable();

    await show([ [ 'tag:script', 2 ], [ 'attribute:onclick', 1 ] ]);

    expect(text()).toBe('');
  });

  it('is not a live region', async () => {
    await show([ [ 'tag:script', 1 ] ]);

    expect(element().querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
  });
});
