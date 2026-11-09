import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitNetworkJobType, GitStatus } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GitActionsComponent } from './git-actions.component';

const KEY = 'web-feature-repository-screen.GitActionsComponent';

function status(changes: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: 'origin/main',
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 2,
    behind: 0,
    changes: [],
    mergeInProgress: false,
    networkJob: null,
    fetchProblem: null,
    ...changes
  };
}

describe('GitActionsComponent', () => {
  let fixture: ComponentFixture<GitActionsComponent>;
  let fetched: number;
  let pushed: number;
  let pulled: number;

  const element = () => fixture.nativeElement as HTMLElement;
  const buttons = () =>
    [ ...element().querySelectorAll('button') ].filter(button => !button.closest('ui-menu')) as HTMLButtonElement[];
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
  const named = (label: string) => buttons().find(button => text(button) === `${KEY}.${label}`) as HTMLButtonElement;
  const liveStatus = () => element().querySelector('[aria-live]');
  const menu = () => document.querySelector('.cdk-overlay-container ui-menu') as HTMLElement | null;
  const items = () => [ ...(menu()?.querySelectorAll('button') ?? []) ] as HTMLButtonElement[];
  const tooltips = () => [ ...document.querySelectorAll('ui-tooltip') ].map(tip => tip.textContent?.trim());

  async function show(
    inputs: { status?: GitStatus | null; running?: GitNetworkJobType | null; narrow?: boolean; } = {}
  ) {
    TestBed.configureTestingModule({ imports: [ GitActionsComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(GitActionsComponent);
    fixture.componentRef.setInput('status', inputs.status === undefined ? status() : inputs.status);
    fixture.componentRef.setInput('running', inputs.running ?? null);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    fetched = 0;
    pushed = 0;
    fixture.componentInstance.fetch.subscribe(() => fetched++);
    fixture.componentInstance.push.subscribe(() => pushed++);
    pulled = 0;
    fixture.componentInstance.pull.subscribe(() => pulled++);
    document.body.append(element());
    await settle(fixture);
  }

  afterEach(() => element().remove());

  it('offers Fetch once the status is read', async () => {
    await show({ status: status({ ahead: 0, upstream: null }) });
    expect(named('fetch').getAttribute('aria-disabled')).toBeNull();
    named('fetch').click();
    expect(fetched).toBe(1);
  });

  it('does not offer Fetch until the status is read', async () => {
    await show({ status: null });
    expect(named('fetch').getAttribute('aria-disabled')).toBe('true');
    named('fetch').click();
    await settle(fixture);
    expect(fetched).toBe(0);
    expect(tooltips()).toContain(`${KEY}.reasons.loading`);
  });

  it('offers Fetch during a merge', async () => {
    await show({ status: status({ mergeInProgress: true }) });
    expect(named('fetch').getAttribute('aria-disabled')).toBeNull();
  });

  it('pushes when there is something to push', async () => {
    await show();

    expect(named('push').getAttribute('aria-disabled')).toBeNull();
    named('push').click();
    expect(pushed).toBe(1);
    expect(fetched).toBe(0);
  });

  it('disables Push with the reason', async () => {
    await show({ status: status({ ahead: 0 }) });

    expect(named('push').getAttribute('aria-disabled')).toBe('true');
    named('push').click();
    await settle(fixture);

    expect(pushed).toBe(0);
    expect(tooltips()).toContain(`${KEY}.reasons.nothingToPush`);
  });

  it('pulls when there is an upstream, also with nothing to pull', async () => {
    await show({ status: status({ ahead: 0, behind: 0 }) });

    expect(named('pull').getAttribute('aria-disabled')).toBeNull();
    named('pull').click();

    expect(pulled).toBe(1);
    expect(fetched).toBe(0);
    expect(pushed).toBe(0);
  });

  it('disables Pull with the reason', async () => {
    await show({ status: status({ upstream: null }) });

    expect(named('pull').getAttribute('aria-disabled')).toBe('true');
    named('pull').click();
    await settle(fixture);

    expect(pulled).toBe(0);
    expect(tooltips()).toContain(`${KEY}.reasons.noUpstream`);
  });

  it('offers Pull for a branch with a remote branch of its name', async () => {
    await show({ status: status({ upstream: null, sameNameRemote: true }) });

    named('pull').click();

    expect(pulled).toBe(1);
  });

  it('shows a pull\'s progress, and disables the others', async () => {
    await show({ running: 'pull' });

    expect(named('pulling').querySelector('ui-spinner')).toBeTruthy();
    expect(named('pulling').getAttribute('aria-disabled')).toBe('true');
    expect(text(liveStatus())).toBe(`${KEY}.pulling`);
    expect(named('fetch').getAttribute('aria-disabled')).toBe('true');
    expect(named('push').getAttribute('aria-disabled')).toBe('true');

    named('pulling').click();
    await settle(fixture);
    expect(pulled).toBe(0);
  });

  it('shows a pull\'s progress on the menu\'s button on a phone', async () => {
    await show({ narrow: true, running: 'pull' });

    expect(buttons()[0].querySelector('ui-spinner')).toBeTruthy();
  });

  it('says to make a commit first in a repository without commits', async () => {
    await show({ status: status({ noCommits: true, upstream: null, ahead: 0 }) });

    named('push').click();
    await settle(fixture);

    expect(tooltips()).toContain(`${KEY}.reasons.noCommits`);
  });

  it('disables the others while one runs, with progress on the one that runs', async () => {
    await show({ running: 'push' });

    const fetch = named('fetch');
    const push = named('pushing');
    expect(push.getAttribute('aria-disabled')).toBe('true');
    expect(push.querySelector('ui-spinner')).toBeTruthy();
    expect(text(liveStatus())).toBe(`${KEY}.pushing`);
    expect(fetch.getAttribute('aria-disabled')).toBe('true');
    expect(fetch.querySelector('ui-spinner')).toBeNull();

    push.click();
    fetch.click();
    await settle(fixture);
    expect(fetched).toBe(0);
    expect(pushed).toBe(0);
    expect(tooltips()).toContain(`${KEY}.reasons.busy`);

    fixture.componentRef.setInput('running', 'fetch');
    await settle(fixture);

    expect(named('fetching').querySelector('ui-spinner')).toBeTruthy();
    expect(named('fetching').getAttribute('aria-disabled')).toBe('true');
    expect(named('push').getAttribute('aria-disabled')).toBe('true');
    expect(named('push').querySelector('ui-spinner')).toBeNull();
    expect(text(liveStatus())).toBe(`${KEY}.fetching`);
  });

  it('says nothing to screen readers while nothing runs', async () => {
    await show();
    expect(text(liveStatus())).toBe('');
  });

  it('shows another tab\'s fetch as running', async () => {
    // The page passes `running` from the status's job too, so a fetch of another tab arrives as the same input.
    await show({ running: 'fetch' });

    expect(named('fetching').querySelector('ui-spinner')).toBeTruthy();
    expect(named('push').getAttribute('aria-disabled')).toBe('true');
    named('push').click();
    named('fetching').click();
    expect(pushed).toBe(0);
    expect(fetched).toBe(0);
  });

  it('moves Fetch, Pull and Push into a menu on a phone', async () => {
    await show({ narrow: true });

    const trigger = buttons()[0];
    expect(buttons()).toHaveLength(1);
    expect(trigger.getAttribute('aria-label')).toBe(`${KEY}.gitActions`);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    trigger.click();
    await settle(fixture);

    expect(items().map(item => text(item))).toEqual([ `${KEY}.fetch`, `${KEY}.pull`, `${KEY}.push` ]);
    items()[0].click();
    await settle(fixture);
    expect(fetched).toBe(1);
    expect(pushed).toBe(0);
    expect(menu()).toBeNull();

    trigger.click();
    await settle(fixture);
    items()[1].click();
    await settle(fixture);
    expect(pulled).toBe(1);
    expect(fetched).toBe(1);
    expect(menu()).toBeNull();

    trigger.click();
    await settle(fixture);
    items()[2].click();
    await settle(fixture);
    expect(pushed).toBe(1);
    expect(pulled).toBe(1);
    expect(fetched).toBe(1);
    expect(menu()).toBeNull();
  });

  it('offers a warning in the menu on a phone, and shows on its button that there is one', async () => {
    await show({ narrow: true });
    let shown = 0;
    fixture.componentInstance.showWarning.subscribe(() => shown++);
    const trigger = buttons()[0];
    const icon = () => trigger.querySelector('ui-icon')?.getAttribute('data-name') ?? trigger.innerHTML;
    const before = icon();

    fixture.componentRef.setInput('warning', 'Couldn\'t check for remote changes');
    await settle(fixture);

    expect(trigger.getAttribute('aria-label')).toBe(`${KEY}.gitActionsWarning`);
    expect(icon()).not.toBe(before);
    trigger.click();
    await settle(fixture);

    expect(items().map(item => text(item))).toEqual([
      `${KEY}.fetch`,
      `${KEY}.pull`,
      `${KEY}.push`,
      'Couldn\'t check for remote changes'
    ]);
    items()[3].click();
    await settle(fixture);

    expect(shown).toBe(1);
    expect(fetched).toBe(0);
    expect(pushed).toBe(0);
  });

  it('shows the reasons under the items that are not offered on a phone', async () => {
    await show({ narrow: true, status: status({ ahead: 0 }) });
    buttons()[0].click();
    await settle(fixture);

    const [ fetch, , push ] = items();
    expect(fetch.getAttribute('aria-disabled')).not.toBe('true');
    expect(text(push.querySelector('.reason'))).toBe(`${KEY}.reasons.nothingToPush`);
    expect(push.getAttribute('aria-disabled')).toBe('true');
    push.click();
    await settle(fixture);

    expect(pushed).toBe(0);
  });

  it.each([ false, true ])('focus goes to its first button, on a phone too (%s)', async narrow => {
    await show({ narrow });

    fixture.componentInstance.focus();

    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('shows progress and the reason of the other item in the menu on a phone', async () => {
    await show({ narrow: true, running: 'fetch' });

    const trigger = buttons()[0];
    expect(trigger.querySelector('ui-spinner')).toBeTruthy();
    expect(text(liveStatus())).toBe(`${KEY}.fetching`);
    trigger.click();
    await settle(fixture);

    const [ fetch, , push ] = items();
    expect(text(fetch)).toBe(`${KEY}.fetching`);
    expect(fetch.getAttribute('aria-disabled')).toBe('true');
    expect(push.getAttribute('aria-disabled')).toBe('true');
    expect(text(push.querySelector('.reason'))).toBe(`${KEY}.reasons.busy`);
  });
});
