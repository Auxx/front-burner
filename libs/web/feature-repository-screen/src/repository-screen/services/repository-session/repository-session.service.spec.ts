import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { Observable, of, Subject, throwError } from 'rxjs';

import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySessionService } from './repository-session.service';

const handbook: RepositorySummary = {
  id: 12,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-28T10:00:00.000Z'
};

function failure(status: number, code: string): Observable<never> {
  return throwError(() =>
    new HttpErrorResponse({ status, error: { code, params: {}, requestId: 'abcdef1234567890', message: code } })
  );
}

describe('RepositorySessionService', () => {
  let answers: Observable<RepositorySummary>[];
  let open: ReturnType<typeof vi.fn>;
  let session: RepositorySessionService;

  beforeEach(() => {
    answers = [];
    open = vi.fn(() => answers.shift() ?? of(handbook));
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ 'errors.internal': 'Something went wrong.' }) ],
      providers: [ RepositorySessionService, { provide: RepositoriesApi, useValue: { open } } ]
    });
    session = TestBed.inject(RepositorySessionService);
  });

  it('is loading until the repository has opened', () => {
    const answer = new Subject<RepositorySummary>();
    answers.push(answer);

    session.start(12);
    expect(session.state()).toBe('loading');

    answer.next(handbook);
    expect(session.state()).toBe('ready');
    expect(session.repository()).toEqual(handbook);
  });

  it('opens a repository once, however often it is started', () => {
    session.start(12);
    session.start(12);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(12);
  });

  it('opens the next repository when started with another ID', () => {
    session.start(12);
    answers.push(new Subject());
    session.start(13);

    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(13);
    expect(session.state()).toBe('loading');
    expect(session.repository()).toBeNull();
  });

  it.each([ 'cloning', 'error', 'needs-confirmation' ] as const)('is not openable while %s', status => {
    answers.push(of({ ...handbook, status }));

    session.start(12);

    expect(session.state()).toBe('not-openable');
    expect(session.repository()?.status).toBe(status);
  });

  it('is missing when the repository is not found', () => {
    answers.push(failure(404, 'not-found'));

    session.start(12);

    expect(session.state()).toBe('missing');
  });

  it('describes any other failure and opens again on retry', () => {
    answers.push(failure(500, 'internal'));

    session.start(12);
    expect(session.state()).toBe('failed');
    expect(session.error()).toEqual({ text: 'Something went wrong.', reference: 'abcdef12' });

    session.retry();
    expect(open).toHaveBeenCalledTimes(2);
    expect(session.state()).toBe('ready');
    expect(session.error()).toBeNull();
  });

  it('ignores the answer for a repository it has left', () => {
    const late = new Subject<RepositorySummary>();
    answers.push(late, of({ ...handbook, id: 13, name: 'guides' }));
    session.start(12);
    session.start(13);

    late.next(handbook);

    expect(session.repository()?.name).toBe('guides');
  });

  it('opens a repository when its clone finishes', () => {
    answers.push(of({ ...handbook, status: 'cloning' }));
    session.start(12);
    expect(session.state()).toBe('not-openable');

    session.statusChanged('ready', null);
    // A second event while it opens does not open it again (FB-11).
    session.statusChanged('ready', null);

    expect(open).toHaveBeenCalledTimes(2);
    expect(session.state()).toBe('ready');
    expect(session.repository()?.status).toBe('ready');
  });

  it('follows the status of a repository that cannot be opened yet', () => {
    answers.push(of({ ...handbook, status: 'cloning' }));
    session.start(12);

    session.statusChanged('error', 'clone-failed');

    expect(open).toHaveBeenCalledTimes(1);
    expect(session.state()).toBe('not-openable');
    expect(session.repository()).toMatchObject({ status: 'error', error: 'clone-failed' });
  });

  it('shows the not-openable state when the working copy goes missing', () => {
    session.start(12);

    session.statusChanged('error', 'working-copy-missing');

    expect(session.state()).toBe('not-openable');
    expect(session.repository()).toMatchObject({ status: 'error', error: 'working-copy-missing' });
  });

  it('ignores a status that leaves an open repository openable', () => {
    session.start(12);

    session.statusChanged('ready', null);

    expect(open).toHaveBeenCalledTimes(1);
    expect(session.state()).toBe('ready');
  });
});
