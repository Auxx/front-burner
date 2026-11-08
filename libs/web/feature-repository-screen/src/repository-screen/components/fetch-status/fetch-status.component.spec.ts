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

  it('Try again is unavailable while a network job runs, and says why', async () => {
    await show({ problem: { code: 'credentials-refused', params: {} } });
    fixture.componentRef.setInput('running', 'push');
    await settle(fixture);

    const again = button(host(), `${FIXES}.retry`);
    expect(again.getAttribute('aria-disabled')).toBe('true');
    again.click();
    expect(retries).toBe(0);

    // A fix only waits for the job: nothing about it conflicts (GA-9).
    const fix = button(host(), `${FIXES}.fix-credentials`);
    expect(fix.getAttribute('aria-disabled')).toBeNull();

    fixture.componentRef.setInput('running', null);
    await settle(fixture);
    expect(again.getAttribute('aria-disabled')).toBeNull();
  });

  describe('where the focus goes', () => {
    let vacated: number;

    async function showFocusable(inputs: Parameters<typeof show>[0]): Promise<void> {
      await show(inputs);
      vacated = 0;
      fixture.componentInstance.vacate.subscribe(() => vacated++);
    }

    it('asks to move it when the status goes away with the focus inside', async () => {
      await showFocusable({ problem: { code: 'network', params: {} } });
      button(host(), `${FIXES}.retry`).focus();

      fixture.componentRef.setInput('problem', null);
      await settle(fixture);

      expect(vacated).toBe(1);
    });

    it('leaves it alone when the status goes away with the focus elsewhere', async () => {
      await showFocusable({ problem: { code: 'network', params: {} } });

      fixture.componentRef.setInput('problem', null);
      await settle(fixture);

      expect(vacated).toBe(0);
    });

    it('stays in place when the problem only changes', async () => {
      await showFocusable({ problem: { code: 'network', params: {} } });
      button(host(), `${FIXES}.retry`).focus();

      fixture.componentRef.setInput('problem', { code: 'remote-failed', params: {} });
      await settle(fixture);

      expect(vacated).toBe(0);
    });

    it.each([
      [ 'Unlock', { lockedKeyName: 'laptop' }, `${FIXES}.unlock` ],
      [ 'a fix', { problem: { code: 'credentials-refused', params: {} } }, `${FIXES}.fix-credentials` ]
    ])('%s moves it before its dialog opens, as the dialog may outlive the status', async (_name, inputs, label) => {
      await showFocusable(inputs);
      let vacatedBeforeAction = 0;
      const seen = () => vacatedBeforeAction = vacated;
      fixture.componentInstance.unlock.subscribe(seen);
      fixture.componentInstance.fix.subscribe(seen);

      button(host(), label).click();

      expect(vacatedBeforeAction).toBe(1);
    });

    it('asks to move it when the panel of a phone goes away with the focus inside', async () => {
      await showFocusable({ problem: { code: 'network', params: {} }, narrow: true });
      (host().querySelector('button') as HTMLButtonElement).click();
      await settle(fixture);
      button(popover() as HTMLElement, `${FIXES}.retry`).focus();

      fixture.componentRef.setInput('problem', null);
      await settle(fixture);

      expect(vacated).toBe(1);
    });
  });

  it('a locked key comes before a stored problem', async () => {
    await show({ problem: { code: 'credentials-refused', params: {} }, lockedKeyName: 'laptop' });

    // Not that it could not check: fetches may run on another session's unlock (RC-20).
    expect(text(host())).not.toContain(`${KEY}.failed`);
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
      expect(trigger().getAttribute('aria-label')).toBe(`${KEY}.locked`);
      trigger().click();
      await settle(fixture);

      expect(text(popover())).not.toContain(`${KEY}.failed`);

      button(popover() as HTMLElement, `${FIXES}.unlock`).click();

      expect(unlocks).toBe(1);
    });
  });
});
