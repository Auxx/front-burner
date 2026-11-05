import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CommitRequest,
  CommitResult,
  CurrentUser,
  FileState,
  GitStatus,
  SaveFileRequest
} from '@front-burner/shared-contracts';
import { FilesApi, GitApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { of, Subject, throwError } from 'rxjs';

import { provideMemoryDrafts } from '../../../testing/drafts';
import { fileContent } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CommitTicksService } from '../commit-ticks/commit-ticks.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { CommitService } from './commit.service';

const HASH = 'b'.repeat(64);

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

const refusal = (code: string) =>
  new HttpErrorResponse({ status: 409, error: { code, params: {}, requestId: 'abcdefgh-1234', message: code } });

describe('CommitService', () => {
  let service: CommitService;
  let openFiles: OpenFilesService;
  let ticks: CommitTicksService;
  /** Every request, in order. */
  let requests: string[];
  let commits: CommitRequest[];
  let commitAnswer: () => ReturnType<GitApi['commit']>;
  let saves: { request: SaveFileRequest; answer: Subject<FileState>; }[];
  let refresh: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof signal<GitStatus | null>>;
  let followed: ReturnType<typeof signal<number | null>>;
  let repository: ReturnType<typeof signal<{ id: number; }>>;

  beforeEach(() => {
    localStorage.clear();
    requests = [];
    commits = [];
    commitAnswer = () => of<CommitResult>({ oid: 'c'.repeat(40) });
    saves = [];
    status = signal<GitStatus | null>(statusOf('a.md', 'b.md'));
    followed = signal<number | null>(12);
    repository = signal({ id: 12 });
    refresh = vi.fn(() => {
      requests.push('status');
      return Promise.resolve();
    });
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        CommitService,
        CommitTicksService,
        OpenFilesService,
        provideMemoryDrafts(),
        { provide: GitStatusStore, useValue: { refresh, status, followed } },
        { provide: RepositorySessionService, useValue: { repository } },
        {
          provide: CurrentUserService,
          useValue: { user: signal({ id: 4 } as CurrentUser), load: () => Promise.resolve({ id: 4 }) }
        },
        {
          provide: GitApi,
          useValue: {
            commit: (_id: number, body: CommitRequest) => {
              requests.push('commit');
              commits.push(body);
              return commitAnswer();
            }
          }
        },
        {
          provide: FilesApi,
          useValue: {
            readFile: (_id: number, query: { path: string; }) => of(fileContent(query.path)),
            saveFile: (_id: number, request: SaveFileRequest) => {
              requests.push(`save ${request.content}`);
              const answer = new Subject<FileState>();
              saves.push({ request, answer });
              return answer;
            }
          }
        },
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: false, breakpoints: {} }), isMatched: () => false }
        }
      ]
    });
    service = TestBed.inject(CommitService);
    openFiles = TestBed.inject(OpenFilesService);
    ticks = TestBed.inject(CommitTicksService);
    TestBed.tick();
  });

  afterEach(() => localStorage.clear());

  /** Waits until the waiting save has been sent. */
  async function sent(count = 1): Promise<void> {
    await vi.waitFor(() => expect(saves.length).toBe(count));
  }

  it('commits the ticked files with the message as written, then reads the status', async () => {
    ticks.setTicked('b.md', false);

    expect(await service.commit('  Subject\n\n# kept\n')).toBe(true);

    expect(commits).toEqual([ { message: '  Subject\n\n# kept\n', paths: [ 'a.md' ] } ]);
    expect(requests).toEqual([ 'commit', 'status' ]);
    expect(service.busy()).toBe(false);
  });

  it('clears the message after a commit, and the committed files leave the list', async () => {
    service.message.set('Subject');

    await service.commit('Subject');

    expect(service.message()).toBe('');
    expect(service.error()).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('AC-GIT-002.5: typing and committing at once includes the last edit', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'the last edit');

    const done = service.commit('Subject');
    await sent();
    expect(saves[0].request.content).toBe('the last edit');
    expect(commits).toEqual([]);

    saves[0].answer.next({ hash: HASH } as FileState);
    saves[0].answer.complete();

    expect(await done).toBe(true);
    expect(requests).toEqual([ 'save the last edit', 'commit', 'status' ]);
  });

  it('does not commit when a waiting save fails', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'the last edit');

    const done = service.commit('Subject');
    await sent();
    saves[0].answer.error(new HttpErrorResponse({ status: 0 }));

    expect(await done).toBe(false);
    expect(commits).toEqual([]);
    expect(service.error()).toMatchObject({ retry: true });
    file.saver.discard();
  });

  it('does not commit when the backend refuses a waiting save, and says why', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'the last edit');

    const done = service.commit('Subject');
    await sent();
    saves[0].answer.error(refusal('file-too-large'));

    expect(await done).toBe(false);
    expect(commits).toEqual([]);
    expect(service.error()).toMatchObject({ reference: 'abcdefgh', retry: false });
    file.saver.discard();
  });

  it('does not commit a ticked file that waits for the user after a change on disk', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'mine');
    openFiles.changedOnDisk('a.md', HASH);

    expect(await service.commit('Subject')).toBe(false);

    expect(commits).toEqual([]);
    expect(service.error()).toMatchObject({ retry: false });
    file.saver.discard();
  });

  it('commits when only a file that is not ticked could not be saved', async () => {
    const file = await openFiles.open('b.md');
    ticks.setTicked('b.md', false);
    file.saver.edit(() => 'the last edit');

    const done = service.commit('Subject');
    await sent();
    saves[0].answer.error(new HttpErrorResponse({ status: 0 }));

    expect(await done).toBe(true);
    expect(commits[0].paths).toEqual([ 'a.md' ]);
    file.saver.discard();
  });

  it('two quick clicks make one commit', async () => {
    const answer = new Subject<CommitResult>();
    commitAnswer = () => answer;

    const first = service.commit('Subject');
    const second = service.commit('Subject');
    expect(service.busy()).toBe(true);
    await vi.waitFor(() => expect(commits.length).toBe(1));
    answer.next({ oid: 'c'.repeat(40) });
    answer.complete();

    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(commits.length).toBe(1);
  });

  it('commits what was ticked when asked, also when the list grows during the waiting save', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'the last edit');

    const done = service.commit('Subject');
    await sent();
    status.set(statusOf('a.md', 'b.md', 'unseen.md'));
    saves[0].answer.next({ hash: HASH } as FileState);
    saves[0].answer.complete();
    await done;

    expect(commits[0].paths).toEqual([ 'a.md', 'b.md' ]);
  });

  it('keeps the message and the ticks when the commit fails', async () => {
    ticks.setTicked('b.md', false);
    service.message.set('Subject');
    commitAnswer = () => throwError(() => refusal('commit-author-not-confirmed'));

    expect(await service.commit('Subject')).toBe(false);

    expect(service.message()).toBe('Subject');
    expect(ticks.ticked()).toEqual([ 'a.md' ]);
    expect(service.error()).toMatchObject({ reference: 'abcdefgh', retry: false });
    expect(service.busy()).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers another try after a network or server error, and clears the error when it starts', async () => {
    commitAnswer = () => throwError(() => new HttpErrorResponse({ status: 503 }));
    await service.commit('Subject');
    expect(service.error()).toMatchObject({ retry: true });

    commitAnswer = () => of({ oid: 'c'.repeat(40) });
    expect(await service.commit('Subject')).toBe(true);
    expect(service.error()).toBeNull();
  });

  it('needs a message and a ticked file', async () => {
    expect(await service.commit('  \n ')).toBe(false);
    ticks.setAll(false);
    expect(await service.commit('Subject')).toBe(false);

    expect(commits).toEqual([]);
    expect(service.error()).toBeNull();
  });

  it('leaves nothing of the last repository', async () => {
    service.message.set('For the last repository');
    commitAnswer = () => throwError(() => refusal('commit-author-not-confirmed'));
    await service.commit('For the last repository');

    followed.set(13);
    TestBed.tick();

    expect(service.message()).toBe('');
    expect(service.error()).toBeNull();
  });

  it('does not touch the next repository\'s form when a commit ends after a navigation', async () => {
    const answer = new Subject<CommitResult>();
    commitAnswer = () => answer;
    const done = service.commit('Subject');
    await vi.waitFor(() => expect(commits.length).toBe(1));

    repository.set({ id: 13 });
    followed.set(13);
    TestBed.tick();
    service.message.set('For the next repository');
    answer.error(new HttpErrorResponse({ status: 503 }));
    await done;

    expect(service.message()).toBe('For the next repository');
    expect(service.error()).toBeNull();
  });
});
