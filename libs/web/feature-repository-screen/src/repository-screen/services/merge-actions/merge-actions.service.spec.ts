import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CurrentUser,
  FileContent,
  FileState,
  GitMergeState,
  SaveFileRequest
} from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { FilesApi, GitApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { MemoryDraftStore, provideMemoryDrafts } from '../../../testing/drafts';
import { fileContent } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { MergeActionsService } from './merge-actions.service';

const K = 'web-feature-repository-screen.AbortMergeDialog';
const ada = { id: 4 } as CurrentUser;

function conflicting(...paths: string[]): GitMergeState {
  return {
    into: 'main',
    from: 'origin/main',
    files: paths.map(path => ({
      path,
      kind: 'both-changed' as const,
      resolved: false,
      editable: true,
      oursSize: 1,
      theirsSize: 1
    })),
    otherFiles: [],
    message: 'Merge'
  };
}

describe('MergeActionsService', () => {
  let service: MergeActionsService;
  let openFiles: OpenFilesService;
  let drafts: MemoryDraftStore;
  let state: ReturnType<typeof signal<GitMergeState | null>>;
  /** Every request that changes or reads files, in order. */
  let requests: string[];
  let abortAnswer: () => Observable<void>;
  let saves: { request: SaveFileRequest; answer: Subject<FileState>; }[];
  let statusRefresh: ReturnType<typeof vi.fn>;
  let mergeRefresh: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; };
  let followed: ReturnType<typeof signal<number | null>>;

  /** Asks to abort, and presses **Abort merge**. */
  async function confirm(): Promise<{ done: Promise<void>; }> {
    const done = service.abort();
    await settleDialog();
    dialogButton(`${K}.abort`)?.click();
    await settleDialog();
    return { done };
  }

  async function opened(path: string) {
    const file = await openFiles.open(path);
    requests = [];
    return file;
  }

  beforeEach(() => {
    drafts = new MemoryDraftStore();
    state = signal<GitMergeState | null>(conflicting('guide.md', 'notes.md'));
    requests = [];
    abortAnswer = () => of(undefined);
    saves = [];
    statusRefresh = vi.fn(() => Promise.resolve());
    mergeRefresh = vi.fn(() => Promise.resolve());
    toast = { show: vi.fn() };
    followed = signal<number | null>(12);
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'errors.merge-abort-failed': 'The merge could not be aborted.',
          'web-feature-repository-screen.MergeActionsService.reference': 'Reference: {{ reference }}'
        })
      ],
      providers: [
        MergeActionsService,
        OpenFilesService,
        provideMemoryDrafts(drafts),
        { provide: ToastService, useValue: toast },
        { provide: GitStatusStore, useValue: { refresh: statusRefresh, followed } },
        { provide: MergeStore, useValue: { state, refresh: mergeRefresh } },
        { provide: RepositorySessionService, useValue: { repository: signal({ id: 12 }) } },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        {
          provide: GitApi,
          useValue: {
            abortMerge: () => {
              requests.push('abort');
              return abortAnswer();
            }
          }
        },
        {
          provide: FilesApi,
          useValue: {
            readFile: (_id: number, query: { path: string; }): Observable<FileContent> => of(fileContent(query.path)),
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
    service = TestBed.inject(MergeActionsService);
    openFiles = TestBed.inject(OpenFilesService);
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('asks before aborting, and cancelling changes nothing', async () => {
    const file = await opened('guide.md');
    file.saver.edit(() => 'mine');
    const done = service.abort();
    await settleDialog();

    expect(overlay().querySelector('rs-abort-merge')).not.toBeNull();
    expect(requests).toEqual([]);

    dialogButton(`${K}.cancel`)?.click();
    await done;

    expect(requests).toEqual([]);
    expect(file.saver.waiting()).toBe('mine');
    expect(statusRefresh).not.toHaveBeenCalled();
  });

  it('aborts, and reads the status', async () => {
    await (await confirm()).done;

    expect(requests).toEqual([ 'abort' ]);
    expect(statusRefresh).toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(service.aborting()).toBe(false);
  });

  it('drops a waiting save, so that it cannot write the merge over the restored file', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const file = await opened('guide.md');
      file.saver.edit(() => 'mine');

      await (await confirm()).done;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(requests).toEqual([ 'abort' ]);
      expect(file.saver.unsaved()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a save in flight before aborting', async () => {
    const file = await opened('guide.md');
    file.saver.edit(() => 'mine');
    void file.saver.flush();
    expect(requests).toEqual([ 'save mine' ]);

    const { done } = await confirm();

    expect(requests).toEqual([ 'save mine' ]);
    expect(service.aborting()).toBe(true);

    saves[0].answer.next({ hash: 'c'.repeat(64), size: 4 });
    saves[0].answer.complete();
    await done;

    expect(requests).toEqual([ 'save mine', 'abort' ]);
  });

  it('does not touch a file that does not conflict', async () => {
    const file = await opened('other.md');
    file.saver.edit(() => 'mine');

    await (await confirm()).done;

    expect(file.saver.waiting()).toBe('mine');
  });

  it('drops every unsaved file when the merge could not be read', async () => {
    state.set(null);
    const file = await opened('guide.md');
    file.saver.edit(() => 'mine');

    await (await confirm()).done;

    expect(mergeRefresh).toHaveBeenCalled();
    expect(file.saver.unsaved()).toBe(false);
    expect(requests).toEqual([ 'abort' ]);
  });

  it('deletes the drafts of conflicting files, and keeps others', async () => {
    const draft = { content: '<<<<<<< main', savedAt: '2026-11-08T10:00:00.000Z' };
    drafts.drafts.set('4/12/notes.md', draft);
    drafts.drafts.set('4/12/other.md', draft);

    await (await confirm()).done;

    expect(drafts.at('notes.md')).toBeUndefined();
    expect(drafts.at('other.md')).toBeDefined();
  });

  it('keeps the drafts when the abort fails', async () => {
    drafts.drafts.set('4/12/notes.md', { content: 'x', savedAt: '2026-11-08T10:00:00.000Z' });
    abortAnswer = () => throwError(() => apiError(500, 'merge-abort-failed'));

    await (await confirm()).done;

    expect(drafts.at('notes.md')).toBeDefined();
  });

  it('gives the waiting save back when the abort fails', async () => {
    const file = await opened('guide.md');
    file.saver.edit(() => 'mine');
    file.preview.read = () => 'mine';
    abortAnswer = () => throwError(() => apiError(500, 'merge-abort-failed'));

    await (await confirm()).done;
    await settleDialog();

    expect(file.saver.held()).toBe(false);
    expect(file.saver.unsaved()).toBe(true);
    expect(requests).toEqual([ 'abort', 'save mine' ]);
  });

  it('says why an abort failed, and the merge stays', async () => {
    abortAnswer = () => throwError(() => apiError(500, 'merge-abort-failed'));

    await (await confirm()).done;

    expect(toast.show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: expect.stringContaining('The merge could not be aborted.'),
      status: 'danger'
    }));
    expect(toast.show.mock.calls[0][0].message).toContain('abcdef01');
    expect(statusRefresh).toHaveBeenCalled();
    expect(mergeRefresh).toHaveBeenCalled();
    expect(service.aborting()).toBe(false);
  });

  it('asks once, however often it is chosen', async () => {
    const first = service.abort();
    await settleDialog();
    await service.abort();
    await settleDialog();

    expect(overlay().querySelectorAll('rs-abort-merge')).toHaveLength(1);

    dialogButton(`${K}.cancel`)?.click();
    await first;
  });

  it('aborts nothing after a switch to another repository', async () => {
    const done = service.abort();
    await settleDialog();
    followed.set(13);
    dialogButton(`${K}.abort`)?.click();
    await done;

    expect(requests).toEqual([]);
  });
});
