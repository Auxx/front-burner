import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitProblemState } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { FetchStatusComponent } from './fetch-status.component';

const KEY = 'web-feature-repository-screen.FetchStatusComponent';
const FIXES = 'web-feature-repository-screen.GitProblemComponent.fixes';

describe('FetchStatusComponent', () => {
  let fixture: ComponentFixture<FetchStatusComponent>;
  let announce: ReturnType<typeof vi.fn>;
  let retries: number;
  let unlocks: number;
  let fixes: GitProblemState[];

  const host = () => fixture.nativeElement as HTMLElement;
  const popover = () => document.querySelector('ui-popover') as HTMLElement | null;
  const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const buttons = (root: Element) => [ ...root.querySelectorAll('button') ];
  const button = (root: Element, label: string) =>
    buttons(root).find(found => text(found) === label) as HTMLButtonElement;

  async function show(
    inputs: { problem?: GitProblemState | null; lockedKeyName?: string | null; narrow?: boolean; }
  ): Promise<void> {
    announce = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [
        FetchStatusComponent,
        translocoTesting({
          'errors.network': 'The connection was lost.',
          'errors.remote-timeout': '{{ host }} didn\'t answer in time. Try again later.'
        })
      ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    });
    fixture = TestBed.createComponent(FetchStatusComponent);
    fixture.componentRef.setInput('problem', inputs.problem ?? null);
    fixture.componentRef.setInput('lockedKeyName', inputs.lockedKeyName ?? null);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    retries = 0;
    unlocks = 0;
    fixes = [];
    fixture.componentInstance.retry.subscribe(() => retries++);
    fixture.componentInstance.unlock.subscribe(() => unlocks++);
    fixture.componentInstance.fix.subscribe(problem => fixes.push(problem));
    await settle(fixture);
  }

  it('shows nothing without a problem or a locked key', async () => {
    await show({});

    expect(text(host())).toBe('');
    expect(buttons(host())).toEqual([]);
  });

  it('says it could not check, followed by the reason with its params', async () => {
    await show({ problem: { code: 'remote-timeout', params: { host: 'github.com' } } });

    expect(text(host())).toContain(`${KEY}.failed github.com didn't answer in time.`);
  });

  it('is never an alert: no live region, no announcement, no focus', async () => {
    await show({ problem: { code: 'network', params: {} } });

    expect(host().querySelector('[role="alert"], [role="status"], [aria-live]')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    expect(host().contains(document.activeElement)).toBe(false);
  });

  it('Try again fetches, and a cause of the network offers nothing else', async () => {
    await show({ problem: { code: 'network', params: {} } });

    expect(buttons(host()).map(text)).toEqual([ `${FIXES}.retry` ]);
    button(host(), `${FIXES}.retry`).click();

    expect(retries).toBe(1);
    expect(fixes).toEqual([]);
  });

  it.each([
    [ 'no-credentials', 'add-credentials' ],
    [ 'credentials-missing', 'add-credentials' ],
    [ 'credentials-refused', 'fix-credentials' ],
    [ 'host-key-changed', 'review-host-key' ],
    [ 'host-key-unknown', 'trust-host' ]
  ])('offers the fix of %s and Try again', async (code, fix) => {
    const problem = { code, params: { host: 'github.com' } };
    await show({ problem });

    expect(buttons(host()).map(text)).toEqual([ `${FIXES}.${fix}`, `${FIXES}.retry` ]);
    button(host(), `${FIXES}.${fix}`).click();

    expect(fixes).toEqual([ problem ]);
    expect(retries).toBe(0);
  });

  it('a locked key comes before a stored problem', async () => {
    await show({ problem: { code: 'credentials-refused', params: {} }, lockedKeyName: 'laptop' });

    expect(text(host())).toContain(`${KEY}.failed`);
    expect(text(host())).toContain(`${KEY}.locked`);
    expect(text(host())).not.toContain('errors.credentials-refused');
    expect(buttons(host()).map(text)).toEqual([ `${FIXES}.unlock` ]);

    button(host(), `${FIXES}.unlock`).click();
    expect(unlocks).toBe(1);
  });

  describe('on a phone', () => {
    const trigger = () => host().querySelector('button') as HTMLButtonElement;

    it('shows the text only after a tap on a phone', async () => {
      await show({ problem: { code: 'network', params: {} }, narrow: true });

      expect(buttons(host())).toHaveLength(1);
      expect(trigger().getAttribute('aria-label')).toBe(`${KEY}.failed`);
      expect(host().textContent).not.toContain('The connection was lost.');
      expect(popover()?.hidden).toBe(true);

      trigger().click();
      await settle(fixture);

      expect(popover()?.hidden).toBe(false);
      expect(text(popover())).toContain(`${KEY}.failed`);
      expect(text(popover())).toContain('The connection was lost.');
      expect(popover()?.closest('rs-fetch-status')).toBeNull();
    });

    it('an action closes the panel, and the focus goes back to the button', async () => {
      await show({ problem: { code: 'network', params: {} }, narrow: true });
      trigger().click();
      await settle(fixture);

      button(popover() as HTMLElement, `${FIXES}.retry`).click();
      await settle(fixture);

      expect(retries).toBe(1);
      expect(popover()?.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger());
    });

    it('offers Unlock for a locked key', async () => {
      await show({ lockedKeyName: 'laptop', narrow: true });
      trigger().click();
      await settle(fixture);

      button(popover() as HTMLElement, `${FIXES}.unlock`).click();

      expect(unlocks).toBe(1);
    });
  });
});
