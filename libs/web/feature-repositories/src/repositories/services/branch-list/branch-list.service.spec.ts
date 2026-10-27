import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { AccessCheckRequest, AccessCheckResult } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { Subject } from 'rxjs';

import { BRANCH_LIST_DELAY_MS, BranchListService } from './branch-list.service';

const handbook = 'https://github.com/acme/handbook.git';
const wiki = 'https://github.com/acme/wiki.git';

describe('BranchListService', () => {
  /** Each access check, with the subject that answers it; `observed` is false once cancelled. */
  let answers: { request: AccessCheckRequest; answer: Subject<AccessCheckResult>; }[];
  let service: BranchListService;

  beforeEach(() => {
    vi.useFakeTimers();
    answers = [];
    const accessCheck = (request: AccessCheckRequest) => {
      const answer = new Subject<AccessCheckResult>();
      answers.push({ request, answer });
      return answer;
    };
    TestBed.configureTestingModule({
      providers: [ BranchListService, { provide: RepositoriesApi, useValue: { accessCheck } } ]
    });
    service = TestBed.inject(BranchListService);
  });

  afterEach(() => vi.useRealTimers());

  function answer(index: number, result: AccessCheckResult): void {
    answers[index].answer.next(result);
    answers[index].answer.complete();
  }

  it('is idle until asked', () => {
    expect(service.state()).toEqual({ kind: 'idle' });
  });

  it('waits until the user stops typing, then runs one access check', () => {
    service.request(handbook, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS - 1);
    service.request(wiki, { mode: 'none' });
    expect(service.state()).toEqual({ kind: 'loading' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS - 1);
    expect(answers).toHaveLength(0);

    vi.advanceTimersByTime(1);

    expect(answers.map(entry => entry.request)).toEqual([ { remoteUrl: wiki, credentials: { mode: 'none' } } ]);
  });

  it('lists the branches with the default one', () => {
    service.request(handbook, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS);

    answer(0, { branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });

    expect(service.state()).toEqual({ kind: 'loaded', branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });
  });

  it('drops a branch list for an outdated URL', () => {
    service.request(handbook, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS);
    service.request(wiki, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS);

    answer(0, { branches: [ 'handbook-only' ], defaultBranch: 'handbook-only' });
    expect(service.state()).toEqual({ kind: 'loading' });
    answer(1, { branches: [ 'main' ], defaultBranch: 'main' });

    expect(service.state()).toEqual({ kind: 'loaded', branches: [ 'main' ], defaultBranch: 'main' });
  });

  it('cancels the request in flight when asked again', () => {
    service.request(handbook, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS);

    service.request(wiki, { mode: 'none' });

    expect(answers[0].answer.observed).toBe(false);
  });

  it('reports a failure, and tries again at once', () => {
    service.request(handbook, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS);
    answers[0].answer.error(
      new HttpErrorResponse({
        status: 504,
        error: { code: 'remote-timeout', params: { host: 'github.com' }, requestId: 'r', message: 'm' }
      })
    );

    expect(service.state()).toEqual({
      kind: 'failed',
      error: expect.objectContaining({ code: 'remote-timeout', params: { host: 'github.com' } })
    });

    service.retry();

    expect(service.state()).toEqual({ kind: 'loading' });
    expect(answers).toHaveLength(2);
    expect(answers[1].request).toEqual(answers[0].request);
  });

  it('goes back to idle when reset', () => {
    service.request(handbook, { mode: 'none' });
    vi.advanceTimersByTime(BRANCH_LIST_DELAY_MS);

    service.reset();

    expect(service.state()).toEqual({ kind: 'idle' });
    expect(answers[0].answer.observed).toBe(false);
  });
});
