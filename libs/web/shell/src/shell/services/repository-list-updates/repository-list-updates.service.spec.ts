import { Component, inject } from '@angular/core';
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
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};
const wiki: RepositorySummary = { ...handbook, id: 2, name: 'wiki', status: 'ready' };

describe('RepositoryListUpdatesService', () => {
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };
  let shown: readonly RepositorySummary[] | null;
  let update: Mock<FollowedRepositoryList['update']>;
  let reload: Mock<FollowedRepositoryList['reload']>;

  /** A component that follows its list, as a page does. */
  @Component({ selector: 'shell-follower', template: '' })
  class FollowerComponent {
    constructor() {
      const list: FollowedRepositoryList = { repositories: () => shown, update, reload };
      inject(RepositoryListUpdatesService).follow(list);
    }
  }

  function follow(repositories: readonly RepositorySummary[] | null) {
    shown = repositories;
    TestBed.configureTestingModule({ providers: [ { provide: PushChannelService, useValue: push } ] });
    return TestBed.createComponent(FollowerComponent);
  }

  function status(repositoryId: number, event: Pick<RepositorySummary, 'status' | 'error'>): void {
    push.events.next({ type: 'repository.status', repositoryId, ...event });
  }

  beforeEach(() => {
    push = { events: new Subject(), reconnected: new Subject() };
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

  it('asks for a reload for a status that arrives while the list loads', () => {
    follow(null);

    status(1, { status: 'ready', error: null });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('reloads after a reconnect', () => {
    follow([ handbook ]);

    push.reconnected.next();

    expect(reload).toHaveBeenCalledTimes(1);
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
