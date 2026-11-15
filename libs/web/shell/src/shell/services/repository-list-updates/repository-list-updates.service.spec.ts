import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { PushChannelService } from '@front-burner/web-core';
import { Subject } from 'rxjs';
import type { Mock } from 'vitest';

import { type FollowedRepositoryList, RepositoryListUpdatesService } from './repository-list-updates.service';

const handbook: RepositorySummary = {
  id: 1,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'cloning',
  error: null,
  warnings: [],
  clone: null,
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};
const wiki: RepositorySummary = { ...handbook, id: 2, name: 'wiki', status: 'ready' };

describe('RepositoryListUpdatesService', () => {
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };
  let shown: ReturnType<typeof signal<readonly RepositorySummary[] | null>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let update: Mock<FollowedRepositoryList['update']>;
  let reload: Mock<FollowedRepositoryList['reload']>;

  /** A component that follows its list, as a page does. */
  @Component({ selector: 'shell-follower', template: '' })
  class FollowerComponent {
    constructor() {
      inject(RepositoryListUpdatesService).follow({ repositories: shown, loading, update, reload });
    }
  }

  function follow(repositories: readonly RepositorySummary[] | null, isLoading = false) {
    shown.set(repositories);
    loading.set(isLoading);
    TestBed.configureTestingModule({ providers: [ { provide: PushChannelService, useValue: push } ] });
    const fixture = TestBed.createComponent(FollowerComponent);
    TestBed.tick();
    return fixture;
  }

  function status(repositoryId: number, event: Pick<RepositorySummary, 'status' | 'error'>): void {
    push.events.next({ type: 'repository.status', repositoryId, ...event });
    TestBed.tick();
  }

  /** The page's request for the list ends, with `repositories` on screen. */
  function loaded(repositories: readonly RepositorySummary[] | null): void {
    shown.set(repositories);
    loading.set(false);
    TestBed.tick();
  }

  beforeEach(() => {
    push = { events: new Subject(), reconnected: new Subject() };
    shown = signal(null);
    loading = signal(false);
    update = vi.fn();
    reload = vi.fn();
  });

  it('patches the status of a listed repository', () => {
    follow([ handbook, wiki ]);

    status(1, { status: 'error', error: 'clone-failed' });

    expect(update).toHaveBeenCalledWith([ { ...handbook, status: 'error', error: 'clone-failed' }, wiki ]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks for a reload for an unknown repository', () => {
    follow([ wiki ]);

    status(1, { status: 'ready', error: null });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('reloads after a reconnect', () => {
    follow([ handbook ]);

    push.reconnected.next();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once after the first load for statuses that arrive while it runs', () => {
    follow(null, true);

    status(1, { status: 'ready', error: null });
    status(2, { status: 'ready', error: null });
    status(1, { status: 'ready', error: null });
    expect(reload).not.toHaveBeenCalled();

    loaded([ handbook ]);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('asks for one reload for many unknown repositories', () => {
    follow([ wiki ]);
    reload.mockImplementation(() => loading.set(true));

    status(1, { status: 'ready', error: null });
    status(3, { status: 'ready', error: null });
    status(4, { status: 'cloning', error: null });
    expect(reload).toHaveBeenCalledTimes(1);

    loaded([ handbook, wiki ]);

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('patches a listed repository during a reload, and reloads once it ends', () => {
    follow([ handbook ], true);

    status(1, { status: 'ready', error: null });

    expect(update).toHaveBeenCalledWith([ { ...handbook, status: 'ready' } ]);
    expect(reload).not.toHaveBeenCalled();

    loaded([ handbook ]);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once after a reconnect during a load, which answers the statuses waiting', () => {
    follow([ wiki ], true);
    status(1, { status: 'ready', error: null });

    push.reconnected.next();
    expect(reload).toHaveBeenCalledTimes(1);

    loaded([ handbook, wiki ]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing while the list failed to load', () => {
    follow(null);

    status(1, { status: 'ready', error: null });

    expect(reload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('asks for nothing after a first load that failed', () => {
    follow(null, true);

    status(1, { status: 'ready', error: null });
    loaded(null);

    expect(reload).not.toHaveBeenCalled();
  });

  it('shows a clone\'s progress, which also means that it no longer waits (RM-7, AR-52)', () => {
    const waiting = { ...handbook, clone: { jobId: 9, state: 'waiting', percent: null } } as const;
    follow([ waiting, wiki ]);

    push.events.next({ type: 'job.progress', jobId: 9, percent: 35 });

    expect(update).toHaveBeenCalledWith([ { ...waiting, clone: { jobId: 9, state: 'running', percent: 35 } }, wiki ]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('drops an ended clone, and reloads for a clone queued again, whose job it does not know', () => {
    const running = { ...handbook, clone: { jobId: 9, state: 'running', percent: 90 } } as const;
    follow([ running, wiki ]);

    status(1, { status: 'ready', error: null });
    expect(update).toHaveBeenLastCalledWith([ { ...running, status: 'ready', error: null, clone: null }, wiki ]);
    expect(reload).not.toHaveBeenCalled();

    status(2, { status: 'cloning', error: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores the progress of other jobs, and before a list', () => {
    follow([ { ...handbook, clone: { jobId: 9, state: 'running', percent: 10 } } ]);
    push.events.next({ type: 'job.progress', jobId: 4, percent: 35 });
    loaded(null);
    push.events.next({ type: 'job.progress', jobId: 9, percent: 35 });

    expect(update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores other events', () => {
    follow([ handbook ]);

    push.events.next({ type: 'git.changed', repositoryId: 1 });

    expect(update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops following when its component is destroyed', () => {
    const fixture = follow([ handbook ]);
    expect(push.events.observed).toBe(true);

    fixture.destroy();

    expect(push.events.observed).toBe(false);
    expect(push.reconnected.observed).toBe(false);
  });
});
