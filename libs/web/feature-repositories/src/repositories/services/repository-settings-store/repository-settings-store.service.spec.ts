import { TestBed } from '@angular/core/testing';
import type { PushEvent, RepositoryDetails } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
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

  beforeEach(() => {
    answers = [];
    requested = [];
    push = { events: new Subject(), reconnected: new Subject() };
    const details = (id: number) => {
      requested.push(id);
      return answers.shift() ?? new Subject<RepositoryDetails>();
    };
    TestBed.configureTestingModule({
      providers: [
        RepositorySettingsStore,
        { provide: RepositoriesApi, useValue: { repositoryDetails: details } },
        { provide: PushChannelService, useValue: push }
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

  it('asks for nothing before a repository is shown', () => {
    push.reconnected.next();

    expect(requested).toEqual([]);
  });
});
