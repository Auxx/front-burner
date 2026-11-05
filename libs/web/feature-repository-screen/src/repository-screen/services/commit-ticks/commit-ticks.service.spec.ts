import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser, GitStatus } from '@front-burner/shared-contracts';
import { CurrentUserService } from '@front-burner/web-core';

import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { CommitTicksService } from './commit-ticks.service';

const ada = { id: 4 } as CurrentUser;

function statusOf(...paths: string[]): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    changes: paths.map(path => ({ path, state: 'modified' as const })),
    mergeInProgress: false
  };
}

describe('CommitTicksService', () => {
  let status: ReturnType<typeof signal<GitStatus | null>>;
  let followed: ReturnType<typeof signal<number | null>>;

  /** A new service, as after a reload of the page. */
  function create(): CommitTicksService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        CommitTicksService,
        { provide: CurrentUserService, useValue: { user: signal(ada) } },
        { provide: GitStatusStore, useValue: { status, followed } }
      ]
    });
    const service = TestBed.inject(CommitTicksService);
    TestBed.tick();
    return service;
  }

  beforeEach(() => {
    localStorage.clear();
    status = signal<GitStatus | null>(statusOf('a.md', 'b.md', 'c.md'));
    followed = signal<number | null>(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('ticks every change by default', () => {
    const ticks = create();

    expect(ticks.ticked()).toEqual([ 'a.md', 'b.md', 'c.md' ]);
    expect(ticks.allState()).toBe('all');
    expect(localStorage.getItem('fb.4.unticked.1')).toBeNull();
  });

  it('AC-GIT-002.23: an unticked file stays unticked after a reload, and a file changed later appears ticked', () => {
    create().setTicked('b.md', false);
    expect(localStorage.getItem('fb.4.unticked.1')).toBe('["b.md"]');

    status.set(null);
    const reloaded = create();
    expect(reloaded.isTicked('b.md')).toBe(false);

    status.set(statusOf('a.md', 'b.md', 'c.md', 'later.md'));
    TestBed.tick();

    expect(reloaded.isTicked('b.md')).toBe(false);
    expect(reloaded.isTicked('later.md')).toBe(true);
    expect(reloaded.ticked()).toEqual([ 'a.md', 'c.md', 'later.md' ]);
    expect(reloaded.allState()).toBe('some');
  });

  it('the top checkbox ticks and clears all', () => {
    const ticks = create();

    ticks.setAll(false);
    expect(ticks.ticked()).toEqual([]);
    expect(ticks.allState()).toBe('none');

    ticks.setAll(true);
    expect(ticks.ticked()).toEqual([ 'a.md', 'b.md', 'c.md' ]);
    expect(ticks.allState()).toBe('all');
    expect(localStorage.getItem('fb.4.unticked.1')).toBe('[]');
  });

  it('says none when there are no changes', () => {
    status.set(statusOf());

    expect(create().allState()).toBe('none');
  });

  it('a file that left the list comes back ticked', () => {
    const ticks = create();
    ticks.setTicked('b.md', false);

    status.set(statusOf('a.md', 'c.md'));
    TestBed.tick();
    expect(localStorage.getItem('fb.4.unticked.1')).toBe('[]');

    status.set(statusOf('a.md', 'b.md', 'c.md'));
    TestBed.tick();
    expect(ticks.isTicked('b.md')).toBe(true);
  });

  it('keeps what it remembers until a status has been read', () => {
    localStorage.setItem('fb.4.unticked.1', '["b.md"]');
    status.set(null);

    const ticks = create();

    expect(ticks.isTicked('b.md')).toBe(false);
    expect(localStorage.getItem('fb.4.unticked.1')).toBe('["b.md"]');
  });

  it('keeps ticks per repository', () => {
    const ticks = create();
    ticks.setTicked('b.md', false);

    // As `GitStatusStore.start` does: the last repository's status goes at once.
    followed.set(2);
    status.set(null);
    TestBed.tick();
    expect(ticks.isTicked('b.md')).toBe(true);
    status.set(statusOf('b.md'));
    TestBed.tick();
    ticks.setAll(false);
    expect(localStorage.getItem('fb.4.unticked.2')).toBe('["b.md"]');

    followed.set(1);
    status.set(null);
    TestBed.tick();
    status.set(statusOf('a.md', 'b.md', 'c.md'));
    TestBed.tick();
    expect(ticks.ticked()).toEqual([ 'a.md', 'c.md' ]);
    expect(localStorage.getItem('fb.4.unticked.1')).toBe('["b.md"]');
  });

  it('ignores what it cannot read as a list of paths', () => {
    for (const stored of [ 'not json', '{"a":1}', '[1,2]' ]) {
      localStorage.setItem('fb.4.unticked.1', stored);
      expect(create().ticked()).toEqual([ 'a.md', 'b.md', 'c.md' ]);
    }
  });

  it('follows what another tab ticks on this device', () => {
    const ticks = create();
    ticks.setTicked('a.md', false);

    localStorage.setItem('fb.4.unticked.1', '["b.md"]');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fb.4.unticked.1' }));
    expect(ticks.ticked()).toEqual([ 'a.md', 'c.md' ]);

    // So that what this tab writes next keeps the other tab's choice.
    ticks.setTicked('c.md', false);
    expect(JSON.parse(localStorage.getItem('fb.4.unticked.1') as string)).toEqual([ 'b.md', 'c.md' ]);
  });

  it('ignores another tab\'s ticks of another repository, and stops listening when destroyed', () => {
    const ticks = create();
    ticks.setTicked('a.md', false);

    localStorage.setItem('fb.4.unticked.2', '["b.md"]');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fb.4.unticked.2' }));
    expect(ticks.ticked()).toEqual([ 'b.md', 'c.md' ]);

    TestBed.resetTestingModule();
    localStorage.setItem('fb.4.unticked.1', '["b.md"]');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fb.4.unticked.1' }));
    expect(ticks.ticked()).toEqual([ 'b.md', 'c.md' ]);
  });

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    const ticks = create();
    ticks.setTicked('b.md', false);

    expect(ticks.ticked()).toEqual([ 'a.md', 'c.md' ]);
  });
});
