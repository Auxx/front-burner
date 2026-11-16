import { TestBed } from '@angular/core/testing';
import type { PushEvent, RepositoryDetails } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService, RemovedRepositoriesService } from '@front-burner/web-core';
import { Observable, of, Subject, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { repositoryDetails } from '../../../testing/repository-details';
import { RepositorySettingsStore } from './repository-settings-store.service';

function failure(status: number, code: string): Observable<never> {
  return throwError(() => apiFailure(status, code));
}

describe('RepositorySettingsStore', () => {
  let store: RepositorySettingsStore;
  let answers: Observable<RepositoryDetails>[];
  let requested: number[];
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };
  let removed: ReturnType<typeof vi.fn<(repositoryId: number) => boolean>>;

  beforeEach(() => {
    answers = [];
    requested = [];
    push = { events: new Subject(), reconnected: new Subject() };
    removed = vi.fn(() => false);
    const details = (id: number) => {
      requested.push(id);
      return answers.shift() ?? new Subject<RepositoryDetails>();
    };
    TestBed.configureTestingModule({
      providers: [
        RepositorySettingsStore,
        { provide: RepositoriesApi, useValue: { repositoryDetails: details } },
        { provide: PushChannelService, useValue: push },
        { provide: RemovedRepositoriesService, useValue: { removed } }
      ]
    });
    store = TestBed.inject(RepositorySettingsStore);
  });

  it('loads the details of the repository', () => {
    answers = [ of(repositoryDetails()) ];
    store.load(7);

    expect(requested).toEqual([ 7 ]);
    expect(store.state()).toBe('ready');
    expect(store.details()?.summary.name).toBe('handbook');
  });

  it('is missing for a repository that does not exist or is another user\'s', () => {
    answers = [ failure(404, 'not-found') ];
    store.load(7);

    expect(store.state()).toBe('missing');
    expect(store.details()).toBeUndefined();
  });

  it('fails when the first load fails, and Try again loads once more', () => {
    answers = [ failure(500, 'internal'), of(repositoryDetails()) ];
    store.load(7);
    expect(store.state()).toBe('failed');

    store.retry();
    expect(store.state()).toBe('ready');
    expect(store.retrying()).toBe(false);
  });

  it('does not follow a removal for a repository that was never shown', () => {
    answers = [ failure(404, 'not-found') ];
    store.load(7);

    expect(removed).not.toHaveBeenCalled();
  });

  it('follows a removal it missed when a reload finds the repository gone, keeping the name until the page goes', () => {
    removed.mockReturnValue(true);
    answers = [ of(repositoryDetails()), failure(404, 'not-found') ];
    store.load(7);
    push.reconnected.next();

    expect(removed).toHaveBeenCalledWith(7);
    expect(store.state()).toBe('ready');
    expect(store.details()?.summary.name).toBe('handbook');
  });

  it('shows a repository found gone as missing when the tab does not leave for it', () => {
    removed.mockReturnValue(false);
    answers = [ of(repositoryDetails()), failure(404, 'not-found') ];
    store.load(7);
    store.reload();

    expect(store.state()).toBe('missing');
    expect(store.details()).toBeUndefined();
  });

  it('keeps the details when a reload fails', () => {
    answers = [ of(repositoryDetails()), failure(500, 'internal') ];
    store.load(7);
    store.reload();

    expect(store.state()).toBe('ready');
    expect(store.details()?.summary.name).toBe('handbook');
  });

  it('reads the details again on the repository\'s status and warnings, not on another\'s', () => {
    answers = [ of(repositoryDetails()), of(repositoryDetails({ status: 'error', error: 'working-copy-missing' })) ];
    store.load(7);

    push.events.next({ type: 'repository.status', repositoryId: 8, status: 'ready', error: null });
    expect(requested).toEqual([ 7 ]);

    push.events.next({ type: 'repository.status', repositoryId: 7, status: 'error', error: 'working-copy-missing' });
    expect(requested).toEqual([ 7, 7 ]);
    expect(store.details()?.summary.status).toBe('error');

    push.events.next({ type: 'repository.warning', repositoryId: 7 });
    expect(requested).toEqual([ 7, 7, 7 ]);
  });

  it('reads the details again when a key is locked or unlocked, and after a reconnect', () => {
    answers = [ of(repositoryDetails()) ];
    store.load(7);

    push.events.next({ type: 'key.locked', keyId: 3 });
    push.events.next({ type: 'key.unlocked', keyId: 3 });
    push.reconnected.next();

    expect(requested).toEqual([ 7, 7, 7, 7 ]);
  });

  it('follows the progress of the repository\'s clone, not of other jobs', () => {
    answers = [ of(repositoryDetails({ status: 'cloning', clone: { jobId: 9, state: 'waiting', percent: null } })) ];
    store.load(7);

    push.events.next({ type: 'job.progress', jobId: 4, percent: 80 });
    expect(store.details()?.summary.clone).toEqual({ jobId: 9, state: 'waiting', percent: null });

    push.events.next({ type: 'job.progress', jobId: 9, percent: 42 });
    expect(store.details()?.summary.clone).toEqual({ jobId: 9, state: 'running', percent: 42 });
    expect(requested).toEqual([ 7 ]);
  });

  it('lets only the latest answer count', () => {
    const first = new Subject<RepositoryDetails>();
    answers = [ first, of(repositoryDetails({ name: 'newer' })) ];
    store.load(7);
    store.reload();
    first.next(repositoryDetails({ name: 'older' }));

    expect(store.details()?.summary.name).toBe('newer');
  });

  it('asks for nothing more once the repository is missing', () => {
    answers = [ failure(404, 'not-found') ];
    store.load(7);

    push.events.next({ type: 'key.unlocked', keyId: 3 });
    push.events.next({ type: 'repository.status', repositoryId: 7, status: 'ready', error: null });
    push.reconnected.next();

    expect(requested).toEqual([ 7 ]);
    expect(store.state()).toBe('missing');
  });

  describe('a retried clone', () => {
    const failed = repositoryDetails(
      { status: 'error', error: 'clone-failed' },
      { errorDetail: 'fatal: not found', errorRequestId: 'req-1' }
    );
    const clone = { jobId: 9, state: 'waiting', percent: null } as const;
    const answer = { ...failed.summary, status: 'cloning', error: null, clone } as const;

    it('shows at once, drops the read on its way and reads again', () => {
      const pending = new Subject<RepositoryDetails>();
      const again = new Subject<RepositoryDetails>();
      answers = [ of(failed), pending, again ];
      store.load(7);
      store.reload();

      store.cloning(answer);
      pending.next(failed);

      expect(requested).toEqual([ 7, 7, 7 ]);
      expect(store.details()).toEqual({ ...failed, summary: answer, errorDetail: null, errorRequestId: null });

      const running = repositoryDetails({ status: 'cloning', clone: { jobId: 9, state: 'running', percent: 40 } });
      again.next(running);
      expect(store.details()).toEqual(running);
    });

    it('keeps what a read showed since the clone was announced, and reads again', () => {
      // The clone ended before the answer to the request arrived.
      answers = [ of(failed), of(repositoryDetails()), new Subject() ];
      store.load(7);
      push.events.next({ type: 'repository.status', repositoryId: 7, status: 'ready', error: null });

      store.cloning(answer);

      expect(store.details()?.summary.status).toBe('ready');
      expect(requested).toEqual([ 7, 7, 7 ]);
    });

    it('ignores a clone of another repository', () => {
      answers = [ of(repositoryDetails()) ];
      store.load(7);

      store.cloning({ ...answer, id: 8 });

      expect(store.details()?.summary.status).toBe('ready');
      expect(requested).toEqual([ 7 ]);
    });
  });

  it('asks for nothing before a repository is shown', () => {
    push.reconnected.next();

    expect(requested).toEqual([]);
  });
});
