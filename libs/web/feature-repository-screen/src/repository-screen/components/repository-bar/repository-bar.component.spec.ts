import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { CurrentUser, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { AuthSessionService } from '@front-burner/web-core';
import { of } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { FetchStatusComponent } from '../fetch-status/fetch-status.component';
import { GitActionsComponent } from '../git-actions/git-actions.component';
import { RepositoryBarComponent } from './repository-bar.component';

const KEY = 'web-feature-repository-screen.RepositoryBarComponent';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

const handbook: RepositorySummary = {
  id: 12,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-28T10:00:00.000Z'
};

describe('RepositoryBarComponent', () => {
  let fixture: ComponentFixture<RepositoryBarComponent>;

  const bar = () => fixture.nativeElement as HTMLElement;

  async function show(inputs: { narrow?: boolean; withFiles?: boolean; } = {}): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ RepositoryBarComponent, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { logout: vi.fn() } },
        { provide: RepositoriesApi, useValue: { recent: () => of({ repositories: [] }) } }
      ]
    });
    fixture = TestBed.createComponent(RepositoryBarComponent);
    fixture.componentRef.setInput('repository', handbook);
    fixture.componentRef.setInput('user', ada);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    fixture.componentRef.setInput('withFiles', inputs.withFiles ?? true);
    await settle(fixture);
  }

  it('shows the save status after the repository name (NV-9)', async () => {
    await show();
    fixture.componentRef.setInput('saveStatus', { kind: 'saving' });
    await settle(fixture);

    const parts = [ ...bar().querySelectorAll('h1, rs-save-status') ];
    expect(parts.map(part => part.localName)).toEqual([ 'h1', 'rs-save-status' ]);
    expect(bar().querySelector('rs-save-status')?.textContent?.trim()).toBe(
      'web-feature-repository-screen.SaveStatusComponent.saving'
    );
  });

  it('shows the branch between the repository name and the save status (NV-9)', async () => {
    await show();
    fixture.componentRef.setInput('gitStatus', {
      branch: 'main',
      noCommits: false,
      lastCommit: null,
      upstream: 'origin/main',
      upstreamGone: false,
      sameNameRemote: false,
      ahead: 0,
      behind: 0,
      changes: [],
      mergeInProgress: false,
      networkJob: null
    });
    fixture.componentRef.setInput('saveStatus', { kind: 'saved' });
    await settle(fixture);

    const parts = [ ...bar().querySelectorAll('h1, rs-git-status-summary, rs-save-status') ];
    expect(parts.map(part => part.localName)).toEqual([ 'h1', 'rs-git-status-summary', 'rs-save-status' ]);
    expect(bar().querySelector('rs-git-status-summary')?.textContent?.trim()).toBe('main');
  });

  it('passes on Pull from the git actions', async () => {
    await show();
    let pulled = 0;
    fixture.componentInstance.pull.subscribe(() => pulled++);

    const actions = fixture.debugElement.query(By.directive(GitActionsComponent));
    (actions.componentInstance as GitActionsComponent).pull.emit();

    expect(pulled).toBe(1);
  });

  it('replaces the status and the actions during a merge', async () => {
    await show();
    fixture.componentRef.setInput('merging', true);
    fixture.componentRef.setInput('mergeState', {
      into: 'main',
      from: 'origin/main',
      files: [],
      otherFiles: [],
      message: 'Merge'
    });
    let aborted = 0;
    fixture.componentInstance.abortMerge.subscribe(() => aborted++);
    await settle(fixture);

    expect(bar().querySelector('rs-git-status-summary')).toBeNull();
    expect(bar().querySelector('rs-git-actions')).toBeNull();
    expect(bar().querySelector('rs-merge-summary')).not.toBeNull();

    (bar().querySelector('rs-merge-summary button') as HTMLButtonElement).click();
    expect(aborted).toBe(1);

    fixture.componentRef.setInput('merging', false);
    await settle(fixture);

    expect(bar().querySelector('rs-merge-summary')).toBeNull();
    expect(bar().querySelector('rs-git-actions')).not.toBeNull();
  });

  it.each([ false, true ])('gives the focus to what offers the actions (merging: %s)', async merging => {
    await show();
    fixture.componentRef.setInput('merging', merging);
    await settle(fixture);
    document.body.append(bar());

    const fetchStatus = fixture.debugElement.query(By.directive(FetchStatusComponent));
    (fetchStatus.componentInstance as FetchStatusComponent).vacate.emit();

    const parent = merging ? 'rs-merge-summary' : 'rs-git-actions';
    expect(document.activeElement?.closest(parent)).not.toBeNull();
    bar().remove();
  });

  const withBranch = async (): Promise<void> => {
    await show();
    fixture.componentRef.setInput('gitStatus', {
      branch: 'main',
      noCommits: false,
      lastCommit: null,
      upstream: 'origin/main',
      upstreamGone: false,
      sameNameRemote: false,
      ahead: 0,
      behind: 0,
      changes: [],
      mergeInProgress: false,
      networkJob: null,
      fetchProblem: null
    });
    await settle(fixture);
  };

  it('passes on that the branch was chosen', async () => {
    await withBranch();
    const opened = vi.fn();
    fixture.componentInstance.openBranches.subscribe(opened);

    (bar().querySelector('rs-git-status-summary button') as HTMLButtonElement).click();

    expect(opened).toHaveBeenCalledOnce();
  });

  it('keeps the focus in the bar when a merge takes the branch button away', async () => {
    await withBranch();
    document.body.append(bar());
    (bar().querySelector('rs-git-status-summary button') as HTMLButtonElement).focus();

    fixture.componentRef.setInput('merging', true);
    await settle(fixture);

    expect(document.activeElement?.closest('rs-merge-summary')).not.toBeNull();
    bar().remove();
  });

  it.each([ true, false ])('keeps the focus in the bar when the actions swap (merge ends: %s)', async ends => {
    await show();
    fixture.componentRef.setInput('merging', ends);
    await settle(fixture);
    document.body.append(bar());
    (bar().querySelector('rs-merge-summary button, rs-git-actions button') as HTMLButtonElement).focus();

    fixture.componentRef.setInput('merging', !ends);
    await settle(fixture);

    expect(document.activeElement?.closest(ends ? 'rs-git-actions' : 'rs-merge-summary')).not.toBeNull();
    bar().remove();
  });

  it.each([
    [
      'a failed fetch',
      { problem: { code: 'network', params: {} } },
      'web-feature-repository-screen.FetchStatusComponent.failed'
    ],
    [ 'a locked key', { lockedKeyName: 'laptop' }, 'web-feature-repository-screen.FetchStatusComponent.locked' ]
  ])('moves %s into the git actions menu on a phone, which opens its panel', async (_case, inputs, title) => {
    await show({ narrow: true });
    fixture.componentRef.setInput('gitStatus', {
      branch: 'main',
      noCommits: false,
      lastCommit: null,
      upstream: 'origin/main',
      upstreamGone: false,
      sameNameRemote: false,
      ahead: 0,
      behind: 0,
      changes: [],
      mergeInProgress: false,
      networkJob: null,
      fetchProblem: 'problem' in inputs ? inputs.problem : null
    });
    fixture.componentRef.setInput('lockedKeyName', 'lockedKeyName' in inputs ? inputs.lockedKeyName : null);
    await settle(fixture);
    document.body.append(bar());

    expect(bar().querySelector('rs-fetch-status button')).toBeNull();
    const trigger = bar().querySelector('rs-git-actions button') as HTMLButtonElement;
    trigger.click();
    await settle(fixture);
    const item = [ ...document.querySelectorAll<HTMLButtonElement>('.cdk-overlay-container ui-menu button') ].find(
      button => button.textContent?.trim() === title
    );
    item?.click();
    await settle(fixture);

    const panel = document.querySelector('ui-popover') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain(title);
    bar().remove();
  });

  it('leaves the focus where it is when it was elsewhere while the actions swap', async () => {
    await show();
    document.body.append(bar());
    const name = bar().querySelector('h1 button') as HTMLButtonElement;
    name.focus();

    fixture.componentRef.setInput('merging', true);
    await settle(fixture);

    expect(document.activeElement).toBe(name);
    bar().remove();
  });

  it('shows no save status for a repository that cannot be opened', async () => {
    await show({ withFiles: false });

    expect(bar().querySelector('rs-save-status')).toBeNull();
    expect(bar().querySelector('rs-git-status-summary')).toBeNull();
  });

  it('shows the bar\'s parts in order', async () => {
    await show();

    const parts = [ ...bar().querySelectorAll('shell-brand-link, h1, shell-user-menu') ];
    expect(parts.map(part => part.localName)).toEqual([ 'shell-brand-link', 'h1', 'shell-user-menu' ]);
    expect(bar().querySelector('h1')?.textContent?.trim()).toBe('handbook');
    expect(bar().querySelector('shell-brand-link a')?.getAttribute('href')).toBe('/');
  });

  it('opens the repository switcher from the name', async () => {
    await show();

    const name = bar().querySelector('h1 button') as HTMLButtonElement;
    expect(name.textContent?.trim()).toBe('handbook');
    expect(name.getAttribute('aria-haspopup')).toBe('menu');

    name.click();
    await settle(fixture);

    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.cdk-overlay-container a[href="/repositories/12/settings"]')).not.toBeNull();
  });

  it('makes the brand link compact on narrow screens', async () => {
    await show({ narrow: true });

    expect(bar().querySelector('shell-brand-link a')?.getAttribute('aria-label')).toBe(
      'web-shell.BrandLinkComponent.dashboard'
    );
  });

  it('has no Files button', async () => {
    await show();

    expect(bar().querySelector('button.files')).toBeNull();
    expect(bar().textContent).not.toContain(`${KEY}.files`);
  });
});
