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
import { CommitAuthorGate } from '../commit-author-gate/commit-author-gate.service';
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
    lastCommit: null,
    upstream: null,
    upstreamGone: false,
    sameNameRemote: false,
    ahead: 0,
    behind: 0,
    changes: paths.map(path => ({ path, state: 'modified' as const })),
    mergeInProgress: false,
    networkJob: null,
    undoableMerge: false,
    fetchProblem: null
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
  let gate: { ready: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; };

  beforeEach(() => {
    localStorage.clear();
    requests = [];
    commits = [];
    commitAnswer = () => of<CommitResult>({ oid: 'c'.repeat(40) });
    saves = [];
    status = signal<GitStatus | null>(statusOf('a.md', 'b.md'));
    followed = signal<number | null>(12);
    repository = signal({ id: 12 });
    gate = { ready: vi.fn(() => Promise.resolve(true)), refresh: vi.fn() };
    refresh = vi.fn(() => {
      requests.push('status');
      return Promise.resolve();
    });
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'errors.changed-on-disk': 'Changed {{ path }}',
          'errors.file-gone': 'Gone {{ path }}',
          'errors.file-held': 'Held {{ path }}'
        })
      ],
      providers: [
        CommitService,
        CommitTicksService,
        OpenFilesService,
        provideMemoryDrafts(),
        { provide: CommitAuthorGate, useValue: gate },
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

  describe('amending', () => {
    const amendable = (message = 'Last commit\n\nBody', oid = 'last'): GitStatus => ({
      ...statusOf('a.md', 'b.md'),
      lastCommit: { oid, amendable: true, message }
    });

    function tickAmend(on = true): void {
      service.amending.set(on);
      TestBed.tick();
    }

    beforeEach(() => {
      status.set(amendable());
      TestBed.tick();
    });

    it('offers it only for a commit that can be amended', () => {
      expect(service.canAmend()).toBe(true);

      status.set({ ...statusOf(), lastCommit: { oid: 'last', amendable: false, message: null } });
      expect(service.canAmend()).toBe(false);

      status.set({ ...statusOf(), lastCommit: null });
      expect(service.canAmend()).toBe(false);

      status.set(null);
      expect(service.canAmend()).toBe(false);
    });

    it('ticking Amend fills in the last commit\'s message', () => {
      tickAmend();

      expect(service.message()).toBe('Last commit\n\nBody');
    });

    it('unticking Amend clears a message it filled in, and keeps one the user changed', () => {
      tickAmend();
      tickAmend(false);
      expect(service.message()).toBe('');

      tickAmend();
      service.message.set('Last commit, better');
      tickAmend(false);
      expect(service.message()).toBe('Last commit, better');
    });

    it('unticking Amend brings back what the user had written before ticking it', () => {
      service.message.set('Written first');

      tickAmend();
      expect(service.message()).toBe('Last commit\n\nBody');

      tickAmend(false);
      expect(service.message()).toBe('Written first');
    });

    it('the option goes away when the commit can no longer be amended, with the old message', () => {
      tickAmend();

      status.set({ ...statusOf('a.md'), lastCommit: { oid: 'last', amendable: false, message: null } });
      TestBed.tick();

      expect(service.canAmend()).toBe(false);
      expect(service.amending()).toBe(false);
      expect(service.message()).toBe('');
    });

    it('keeps a message the user changed when the option goes away', () => {
      tickAmend();
      service.message.set('Mine');

      status.set({ ...statusOf('a.md'), lastCommit: { oid: 'last', amendable: false, message: null } });
      TestBed.tick();

      expect(service.amending()).toBe(false);
      expect(service.message()).toBe('Mine');
    });

    it('stays ticked while the status changes, with the same last commit', () => {
      tickAmend();

      status.set(amendable());
      TestBed.tick();

      expect(service.amending()).toBe(true);
      expect(service.message()).toBe('Last commit\n\nBody');
    });

    it('is unticked when the last commit was replaced, so that its old message does not replace the new one', () => {
      service.message.set('Written first');
      tickAmend();

      status.set(amendable('Amended elsewhere', 'other'));
      TestBed.tick();

      expect(service.canAmend()).toBe(true);
      expect(service.amending()).toBe(false);
      expect(service.message()).toBe('Written first');

      tickAmend();
      expect(service.message()).toBe('Amended elsewhere');
    });

    it('sends amend with the ticked files, then starts over', async () => {
      ticks.setTicked('b.md', false);
      tickAmend();

      expect(await service.commit('Better')).toBe(true);
      TestBed.tick();

      expect(commits).toEqual([ { message: 'Better', paths: [ 'a.md' ], amend: true } ]);
      expect(requests).toEqual([ 'commit', 'status' ]);
      expect(service.amending()).toBe(false);
      expect(service.message()).toBe('');
    });

    it('works with no ticked files', async () => {
      ticks.setAll(false);
      tickAmend();

      expect(await service.commit('Better')).toBe(true);

      expect(commits).toEqual([ { message: 'Better', paths: [], amend: true } ]);
    });

    it('a commit without Amend still needs a ticked file, and does not send amend', async () => {
      ticks.setAll(false);
      expect(await service.commit('Subject')).toBe(false);
      expect(commits).toEqual([]);

      ticks.setAll(true);
      expect(await service.commit('Subject')).toBe(true);
      expect(commits).toEqual([ { message: 'Subject', paths: [ 'a.md', 'b.md' ] } ]);
    });

    it('refuses an amend of a commit that was pushed meanwhile', async () => {
      commitAnswer = () => throwError(() => refusal('amend-not-allowed'));
      tickAmend();

      expect(await service.commit('Last commit\n\nBody')).toBe(false);
      TestBed.tick();

      // The user is told, and the old message can't be committed by accident.
      expect(service.error()?.text).toBe('amend-not-allowed');
      expect(service.error()?.retry).toBe(false);
      expect(service.amending()).toBe(false);
      expect(service.message()).toBe('');
      expect(requests).toEqual([ 'commit', 'status' ]);

      // The status that follows does not take the message away.
      status.set({ ...statusOf('a.md', 'b.md'), lastCommit: { oid: 'last', amendable: false, message: null } });
      TestBed.tick();
      expect(service.error()?.text).toBe('amend-not-allowed');
    });

    it('a failure goes away when Amend is ticked', async () => {
      commitAnswer = () => throwError(() => refusal('nothing-to-commit'));
      service.message.set('Subject');
      await service.commit('Subject');
      TestBed.tick();
      expect(service.error()).not.toBeNull();

      tickAmend();

      expect(service.error()).toBeNull();
    });

    it('starts over in another repository', () => {
      tickAmend();

      followed.set(13);
      repository.set({ id: 13 });
      TestBed.tick();

      expect(service.amending()).toBe(false);
      expect(service.message()).toBe('');
    });
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

  it('AC-GIT-002.5: includes the first edit of a file that the list does not show yet', async () => {
    const file = await openFiles.open('new-edit.md');
    file.saver.edit(() => 'the first edit');
    expect(service.paths()).toEqual([ 'a.md', 'b.md', 'new-edit.md' ]);

    const done = service.commit('Subject');
    await sent();
    saves[0].answer.next({ hash: HASH } as FileState);
    saves[0].answer.complete();
    await done;

    expect(commits[0].paths).toEqual([ 'a.md', 'b.md', 'new-edit.md' ]);
  });

  it('can commit only the first edit of a file, when nothing is listed yet', async () => {
    status.set(statusOf());
    const file = await openFiles.open('new-edit.md');
    file.saver.edit(() => 'the first edit');

    const done = service.commit('Subject');
    await sent();
    saves[0].answer.next({ hash: HASH } as FileState);
    saves[0].answer.complete();

    expect(await done).toBe(true);
    expect(commits[0].paths).toEqual([ 'new-edit.md' ]);
  });

  it('keeps out an unticked file that has unsaved edits', async () => {
    const file = await openFiles.open('b.md');
    ticks.setTicked('b.md', false);
    file.saver.edit(() => 'the last edit');

    expect(service.paths()).toEqual([ 'a.md' ]);
    file.saver.discard();
  });

  it('does not commit when a save fails after the user left the repository', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'the last edit');

    const done = service.commit('Subject');
    await sent();
    repository.set({ id: 13 });
    followed.set(13);
    TestBed.tick();
    saves[0].answer.error(new HttpErrorResponse({ status: 503 }));

    expect(await done).toBe(false);
    expect(commits).toEqual([]);
    expect(service.error()).toBeNull();
    file.saver.discard();
  });

  it('does not commit a ticked file whose save is held, as during a rename', async () => {
    const file = await openFiles.open('a.md');
    const release = file.saver.hold();
    file.saver.edit(() => 'the last edit');

    expect(await service.commit('Subject')).toBe(false);

    expect(commits).toEqual([]);
    expect(service.error()).toMatchObject({ text: 'Held a.md', retry: true });
    release();
    file.saver.discard();
  });

  it('names the file and its way out when it was deleted elsewhere with unsaved edits', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'mine');
    openFiles.markGone('a.md');

    expect(await service.commit('Subject')).toBe(false);

    expect(service.error()).toMatchObject({ text: 'Gone a.md', retry: false });
    file.saver.discard();
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
    expect(service.error()).toMatchObject({ text: `Changed a.md`, retry: false });
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

  describe('the commit author', () => {
    it('asks before anything else', async () => {
      const file = await openFiles.open('a.md');
      file.saver.edit(() => 'the last edit');
      let answer!: (ready: boolean) => void;
      gate.ready.mockReturnValueOnce(new Promise(resolve => (answer = resolve)));

      const done = service.commit('Subject');
      await new Promise(resolve => setTimeout(resolve));
      expect(requests).toEqual([]);
      expect(service.busy()).toBe(true);

      answer(false);

      expect(await done).toBe(false);
      expect(requests).toEqual([]);
    });

    it('cancelling the question makes no commit, and keeps the message, with no error', async () => {
      gate.ready.mockResolvedValueOnce(false);
      service.message.set('Subject');

      expect(await service.commit('Subject')).toBe(false);

      expect(commits).toEqual([]);
      expect(service.message()).toBe('Subject');
      expect(service.error()).toBeNull();
      expect(service.busy()).toBe(false);
    });

    it('shows an error when the author can\'t be read, and offers another try', async () => {
      gate.ready.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

      expect(await service.commit('Subject')).toBe(false);

      expect(commits).toEqual([]);
      expect(service.error()?.retry).toBe(true);
    });

    it('shows the API\'s refusal and reads the author again, so that the next press asks', async () => {
      commitAnswer = () => throwError(() => refusal('commit-author-not-confirmed'));

      expect(await service.commit('Subject')).toBe(false);

      expect(commits).toHaveLength(1);
      expect(gate.refresh).toHaveBeenCalledTimes(1);
      expect(service.error()?.retry).toBe(false);
    });

    it('does not read the author again after any other failure', async () => {
      commitAnswer = () => throwError(() => refusal('nothing-to-commit'));

      await service.commit('Subject');

      expect(gate.refresh).not.toHaveBeenCalled();
    });

    it('makes no commit in the next repository when the user left during the question', async () => {
      let answer!: (ready: boolean) => void;
      gate.ready.mockReturnValueOnce(new Promise(resolve => (answer = resolve)));

      const done = service.commit('Subject');
      await new Promise(resolve => setTimeout(resolve));
      repository.set({ id: 13 });
      answer(true);

      expect(await done).toBe(false);
      expect(commits).toEqual([]);
    });
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
    commitAnswer = () => throwError(() => refusal('nothing-to-commit'));

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

  it('does not offer the committed files again when the status could not be read', async () => {
    await service.commit('Subject');
    expect(service.paths()).toEqual([]);
    expect(await service.commit('Another')).toBe(false);
    expect(commits.length).toBe(1);

    // A later read knows better, also about a file that changed again.
    status.set(statusOf('a.md'));
    expect(service.paths()).toEqual([ 'a.md' ]);
  });

  it('still offers a file edited again after the commit, before the status was read', async () => {
    await service.commit('Subject');
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'edited again');

    expect(service.paths()).toEqual([ 'a.md' ]);
    file.saver.discard();
  });

  describe('a failure that is no longer true', () => {
    beforeEach(async () => {
      commitAnswer = () => throwError(() => refusal('nothing-to-commit'));
      await service.commit('Subject');
      TestBed.tick();
      expect(service.error()).not.toBeNull();
    });

    it('stays while nothing changes, also when the same status is read again', () => {
      status.set(statusOf('a.md', 'b.md'));
      TestBed.tick();

      expect(service.error()).not.toBeNull();
    });

    it('goes when the message changes', () => {
      service.message.set('Another');
      TestBed.tick();

      expect(service.error()).toBeNull();
    });

    it('goes when the ticks change', () => {
      ticks.setTicked('b.md', false);
      TestBed.tick();

      expect(service.error()).toBeNull();
    });
  });

  it('removes a failed save\'s error once the file is saved', async () => {
    const file = await openFiles.open('a.md');
    file.saver.edit(() => 'mine');
    openFiles.changedOnDisk('a.md', HASH);
    await service.commit('Subject');
    TestBed.tick();
    expect(service.error()).not.toBeNull();

    file.saver.discard();
    TestBed.tick();

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
    commitAnswer = () => throwError(() => refusal('nothing-to-commit'));
    await service.commit('For the last repository');

    followed.set(13);
    TestBed.tick();

    expect(service.message()).toBe('');
    expect(service.error()).toBeNull();
  });

  it('is busy only for the repository it commits in, which can commit again meanwhile', async () => {
    const answer = new Subject<CommitResult>();
    commitAnswer = () => answer;
    const first = service.commit('Subject');
    expect(service.busy()).toBe(true);
    await vi.waitFor(() => expect(commits.length).toBe(1));

    repository.set({ id: 13 });
    followed.set(13);
    TestBed.tick();
    expect(service.busy()).toBe(false);
    commitAnswer = () => of({ oid: 'c'.repeat(40) });
    expect(await service.commit('For the next repository')).toBe(true);
    expect(commits.length).toBe(2);

    repository.set({ id: 12 });
    expect(service.busy()).toBe(true);
    answer.next({ oid: 'c'.repeat(40) });
    answer.complete();
    await first;
    expect(service.busy()).toBe(false);
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
