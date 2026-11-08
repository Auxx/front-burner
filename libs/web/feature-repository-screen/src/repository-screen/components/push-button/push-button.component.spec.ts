import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitStatus } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { PushButtonComponent, pushUnavailableReason } from './push-button.component';

const KEY = 'web-feature-repository-screen.PushButtonComponent';

function status(changes: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: 'origin/main',
    upstreamGone: false,
    ahead: 2,
    behind: 0,
    changes: [],
    mergeInProgress: false,
    networkJob: null,
    fetchProblem: null,
    ...changes
  };
}

describe('pushUnavailableReason', () => {
  it.each<[ string, Partial<GitStatus>, string | null ]>([
    [ 'commits to push', {}, null ],
    [ 'an unpublished branch', { upstream: null, ahead: 0 }, null ],
    [ 'an upstream that is gone', { upstreamGone: true, ahead: 0 }, null ],
    [ 'nothing to push', { ahead: 0 }, 'nothingToPush' ],
    [ 'no commits', { noCommits: true, upstream: null, ahead: 0 }, 'noCommits' ],
    [ 'no branch', { branch: null }, 'noBranch' ],
    [ 'a merge in progress', { mergeInProgress: true }, 'merging' ]
  ])('with %s', (_name, changes, reason) => {
    expect(pushUnavailableReason(status(changes))).toBe(reason);
  });

  it('until a status has been read', () => {
    expect(pushUnavailableReason(null)).toBe('loading');
  });
});

describe('PushButtonComponent', () => {
  let fixture: ComponentFixture<PushButtonComponent>;
  let pushed: number;

  const element = () => fixture.nativeElement as HTMLElement;
  const button = () => element().querySelector('button') as HTMLButtonElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
  const liveStatus = () => element().querySelector('[aria-live]');
  const menu = () => document.querySelector('.cdk-overlay-container ui-menu') as HTMLElement | null;
  const tooltips = () => [ ...document.querySelectorAll('ui-tooltip') ].map(tip => tip.textContent?.trim());

  async function show(inputs: { status?: GitStatus | null; running?: boolean; narrow?: boolean; } = {}) {
    TestBed.configureTestingModule({ imports: [ PushButtonComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(PushButtonComponent);
    fixture.componentRef.setInput('status', inputs.status === undefined ? status() : inputs.status);
    fixture.componentRef.setInput('running', inputs.running ?? false);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    pushed = 0;
    fixture.componentInstance.push.subscribe(() => pushed++);
    document.body.append(element());
    await settle(fixture);
  }

  afterEach(() => element().remove());

  it('pushes when there is something to push', async () => {
    await show();

    expect(text(button())).toBe(`${KEY}.push`);
    expect(button().getAttribute('aria-disabled')).toBeNull();

    button().click();
    expect(pushed).toBe(1);
  });

  it('disables Push with the reason', async () => {
    await show({ status: status({ ahead: 0 }) });

    expect(button().getAttribute('aria-disabled')).toBe('true');
    button().click();
    await settle(fixture);

    expect(pushed).toBe(0);
    expect(tooltips()).toContain(`${KEY}.reasons.nothingToPush`);
  });

  it('says to make a commit first in a repository without commits', async () => {
    await show({ status: status({ noCommits: true, upstream: null, ahead: 0 }) });

    button().click();
    await settle(fixture);

    expect(tooltips()).toContain(`${KEY}.reasons.noCommits`);
  });

  it('shows progress while pushing', async () => {
    await show();
    expect(text(liveStatus())).toBe('');

    fixture.componentRef.setInput('running', true);
    await settle(fixture);

    expect(text(button())).toBe(`${KEY}.pushing`);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().querySelector('ui-spinner')).toBeTruthy();
    expect(text(liveStatus())).toBe(`${KEY}.pushing`);

    button().click();
    expect(pushed).toBe(0);
  });

  it('moves Push into a menu on a phone', async () => {
    await show({ narrow: true });

    expect(button().getAttribute('aria-label')).toBe(`${KEY}.gitActions`);
    expect(button().getAttribute('aria-haspopup')).toBe('menu');
    button().click();
    await settle(fixture);

    const item = menu()?.querySelector('button') as HTMLButtonElement;
    expect(text(item)).toBe(`${KEY}.push`);
    item.click();
    await settle(fixture);

    expect(pushed).toBe(1);
  });

  it('shows the reason under a Push item that is not offered on a phone', async () => {
    await show({ narrow: true, status: status({ ahead: 0 }) });
    button().click();
    await settle(fixture);

    const item = menu()?.querySelector('button') as HTMLButtonElement;
    expect(text(item.querySelector('.reason'))).toBe(`${KEY}.reasons.nothingToPush`);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    item.click();
    await settle(fixture);

    expect(pushed).toBe(0);
  });
});
