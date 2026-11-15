import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { PushChannelService } from '@front-burner/web-core';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import type { Mock } from 'vitest';

import { type FollowedList, followRepositoryList, type FollowRepositoryListOptions } from './follow-repository-list';

const handbook: RepositorySummary = {
  id: 1,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'cloning',
  error: null,
  warnings: [],
  clone: { jobId: 9, state: 'waiting', percent: null },
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
};
const wiki: RepositorySummary = { ...handbook, id: 2, name: 'wiki', status: 'ready', clone: null };

type Answer = Observable<{ repositories: readonly RepositorySummary[]; }>;

describe('followRepositoryList', () => {
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };
  let answers: Answer[];
  let requests: number;
  let loaded: Mock<NonNullable<FollowRepositoryListOptions['loaded']>>;
  let list: FollowedList;

  /** A page that follows its list. */
  @Component({ selector: 'shell-list-page', template: '' })
  class ListPageComponent {
    constructor() {
      list = followRepositoryList(() => {
        requests++;
        return answers.shift() ?? NEVER;
      }, { loaded });
    }
  }

  async function open(...queued: Answer[]): Promise<void> {
    answers = queued;
    TestBed.configureTestingModule({ providers: [ { provide: PushChannelService, useValue: push } ] });
    TestBed.createComponent(ListPageComponent);
    await settle();
  }

  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve));
    TestBed.tick();
  }

  beforeEach(() => {
    push = { events: new Subject(), reconnected: new Subject() };
    requests = 0;
    loaded = vi.fn();
  });

  it('loads at once, and is loading until the answer', async () => {
    await open(NEVER);

    expect(requests).toBe(1);
    expect(list.state()).toEqual({ kind: 'loading' });
    expect(list.repositories()).toBeNull();
  });

  it('shows the answer and tells the page', async () => {
    await open(of({ repositories: [ handbook, wiki ] }));

    expect(list.repositories()).toEqual([ handbook, wiki ]);
    expect(loaded).toHaveBeenCalledWith([ handbook, wiki ]);
  });

  it('shows a failed first load, and Try again loads again', async () => {
    await open(throwError(() => new Error('down')), of({ repositories: [ wiki ] }));
    expect(list.state()).toEqual({ kind: 'failed' });

    const retried = list.retry();
    expect(list.retrying()).toBe(true);
    await retried;

    expect(list.retrying()).toBe(false);
    expect(list.repositories()).toEqual([ wiki ]);
  });

  it('follows a clone\'s progress and status', async () => {
    await open(of({ repositories: [ handbook ] }));

    push.events.next({ type: 'job.progress', jobId: 9, percent: 50 });
    expect(list.repositories()?.[0]?.clone).toEqual({ jobId: 9, state: 'running', percent: 50 });

    push.events.next({ type: 'repository.status', repositoryId: 1, status: 'ready', error: null });
    expect(list.repositories()?.[0]).toMatchObject({ status: 'ready', clone: null });
  });

  it('keeps the list on screen when a reload fails', async () => {
    await open(of({ repositories: [ wiki ] }), throwError(() => new Error('down')));

    push.reconnected.next();
    await settle();

    expect(requests).toBe(2);
    expect(list.repositories()).toEqual([ wiki ]);
  });

  it('counts only the answer to the latest request', async () => {
    const first = new Subject<{ repositories: readonly RepositorySummary[]; }>();
    await open(first, of({ repositories: [ wiki ] }));

    push.reconnected.next();
    await settle();
    first.next({ repositories: [ handbook ] });
    first.complete();
    await settle();

    expect(list.repositories()).toEqual([ wiki ]);
    expect(loaded).toHaveBeenCalledTimes(1);
  });
});
