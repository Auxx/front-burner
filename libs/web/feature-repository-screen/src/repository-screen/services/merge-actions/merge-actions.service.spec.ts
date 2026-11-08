import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
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
import { EntryCommandsService, OWN_CHANGE_MS } from '../entry-commands/entry-commands.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { MergeActionsService } from './merge-actions.service';

const K = 'web-feature-repository-screen.AbortMergeDialog';
const ada = { id: 4 } as CurrentUser;
const RESTORED = 'b'.repeat(64);

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
  let mergeAnswer: () => Observable<GitMergeState>;
  let readAnswer: (path: string) => Observable<FileContent>;
  let saves: { request: SaveFileRequest; answer: Subject<FileState>; }[];
  let statusRefresh: ReturnType<typeof vi.fn>;
  let mergeRefresh: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; };
  let repository: ReturnType<typeof signal<{ id: number; }>>;
  let routePath: string;
  /** The paths marked as this tab's own change, in order, and those released. */
  let own: string[];
  let released: string[];

  /** Asks to abort, and presses **Abort merge**. */
  async function confirm(): Promise<{ done: Promise<void>; }> {
    const done = service.abort();
    await settleDialog();
    dialogButton(`${K}.abort`)?.click();
    await settleDialog();
    return { done };
  }

  /** Opens `path` as loaded from disk; later reads answer what the abort restored. */
  async function opened(path: string) {
    const file = await openFiles.open(path);
    requests = [];
    readAnswer = read => of(fileContent(read, { content: 'restored', hash: RESTORED }));
    return file;
  }

  beforeEach(() => {
    drafts = new MemoryDraftStore();
    state = signal<GitMergeState | null>(conflicting('guide.md', 'notes.md'));
    requests = [];
    abortAnswer = () => of(undefined);
    mergeAnswer = () => of(conflicting('guide.md'));
    readAnswer = path => of(fileContent(path));
    saves = [];
    statusRefresh = vi.fn(() => Promise.resolve());
    mergeRefresh = vi.fn(() => Promise.resolve());
    toast = { show: vi.fn() };
    repository = signal({ id: 12 });
    routePath = '';
    own = [];
    released = [];
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
        { provide: GitStatusStore, useValue: { refresh: statusRefresh } },
        { provide: MergeStore, useValue: { state, refresh: mergeRefresh } },
        { provide: RepositorySessionService, useValue: { repository } },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        {
          provide: EntryCommandsService,
          useValue: {
            ownChange: (path: string) => {
              own.push(path);
              return () => released.push(path);
            }
          }
        },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap({ path: routePath }) };
            }
          }
        },
        {
          provide: GitApi,
          useValue: {
            gitMerge: () => {
              requests.push('merge');
              return mergeAnswer();
            },
            abortMerge: () => {
              requests.push('abort');
              return abortAnswer();
            }
          }
        },
        {
          provide: FilesApi,
          useValue: {
            readFile: (_id: number, query: { path: string; }) => {
              requests.push(`read ${query.path}`);
              return readAnswer(query.path);
            },
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
    expect(own).toEqual([]);
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

      expect(requests).toEqual([ 'abort', 'read guide.md' ]);
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

    expect(requests).toEqual([ 'save mine', 'abort', 'read guide.md' ]);
  });

  it('loads an open conflicting file again before its saves go on, without any event', async () => {
    const file = await opened('guide.md');
    const revision = file.revision();
    file.saver.edit(() => 'mine');

    await (await confirm()).done;

    expect(file.file.content).toBe('restored');
    expect(file.revision()).toBe(revision + 1);
    expect(file.saver.held()).toBe(false);
    expect(file.saver.unsaved()).toBe(false);
  });

  it('loads it again also when its content on disk is what it last read', async () => {
    const file = await opened('guide.md');
    readAnswer = path => of(fileContent(path));
    const revision = file.revision();
    file.saver.edit(() => 'mine');

    await (await confirm()).done;

    expect(file.revision()).toBe(revision + 1);
    expect(file.saver.unsaved()).toBe(false);
  });

  it('makes the file wait for Reload when it cannot be loaded again, so that typing saves nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const file = await opened('guide.md');
      readAnswer = () => throwError(() => new HttpErrorResponse({ status: 503 }));

      await (await confirm()).done;

      expect(file.changed()).not.toBeNull();

      file.saver.edit(() => '<<<<<<< main');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(requests.filter(request => request.startsWith('save'))).toEqual([]);
      expect(released).toEqual([ 'guide.md' ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts the files as its own change from the request until after the reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await opened('guide.md');
      routePath = 'notes.md';
      const answer = new Subject<void>();
      abortAnswer = () => answer;

      const { done } = await confirm();

      expect(own).toEqual([ 'guide.md', 'notes.md' ]);
      expect(released).toEqual([]);

      answer.complete();
      await done;

      expect(released).toEqual([]);
      await vi.advanceTimersByTimeAsync(OWN_CHANGE_MS);
      expect(released.toSorted()).toEqual([ 'guide.md', 'notes.md' ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not touch a file that does not conflict', async () => {
    const file = await opened('other.md');
    file.saver.edit(() => 'mine');

    await (await confirm()).done;

    expect(file.saver.waiting()).toBe('mine');
    expect(own).not.toContain('other.md');
  });

  it('reads the merge first when it has not been read, and drops only what it names', async () => {
    state.set(null);
    const conflict = await opened('guide.md');
    const other = await opened('other.md');
    conflict.saver.edit(() => 'mine');
    other.saver.edit(() => 'theirs');
    drafts.drafts.set('4/12/closed.md', { content: '<<<<<<< main', savedAt: '2026-11-08T10:00:00.000Z' });
    mergeAnswer = () => of(conflicting('guide.md', 'closed.md'));

    await (await confirm()).done;

    expect(requests).toEqual([ 'merge', 'abort', 'read guide.md' ]);
    expect(conflict.saver.unsaved()).toBe(false);
    expect(other.saver.waiting()).toBe('theirs');
    expect(drafts.at('closed.md')).toBeUndefined();
  });

  it('says why and changes nothing when the merge cannot be read', async () => {
    state.set(null);
    const file = await opened('guide.md');
    file.saver.edit(() => 'mine');
    mergeAnswer = () => throwError(() => apiError(500, 'merge-abort-failed'));

    await (await confirm()).done;

    expect(requests).toEqual([ 'merge' ]);
    expect(file.saver.waiting()).toBe('mine');
    expect(toast.show).toHaveBeenCalledOnce();
    expect(service.aborting()).toBe(false);
  });

  it('says nothing when the read finds that the merge ended', async () => {
    state.set(null);
    mergeAnswer = () => throwError(() => apiError(409, 'no-merge-in-progress'));

    await (await confirm()).done;

    expect(requests).toEqual([ 'merge' ]);
    expect(toast.show).not.toHaveBeenCalled();
    expect(statusRefresh).toHaveBeenCalled();
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
    expect(released).toEqual([ 'guide.md' ]);
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

  it('treats an abort answered no merge as the merge having ended elsewhere', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const file = await opened('guide.md');
      file.saver.edit(() => '<<<<<<< main');
      file.preview.read = () => '<<<<<<< main';
      abortAnswer = () => throwError(() => apiError(409, 'no-merge-in-progress'));

      await (await confirm()).done;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(toast.show).not.toHaveBeenCalled();
      expect(requests).toEqual([ 'abort', 'read guide.md' ]);
      expect(file.saver.unsaved()).toBe(false);
      expect(file.file.content).toBe('restored');
    } finally {
      vi.useRealTimers();
    }
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

  it('aborts nothing after a switch to another repository while it asks', async () => {
    const done = service.abort();
    await settleDialog();
    repository.set({ id: 13 });
    dialogButton(`${K}.abort`)?.click();
    await done;

    expect(requests).toEqual([]);
  });

  it('leaves the other repository\'s file alone after a switch while the merge is read', async () => {
    state.set(null);
    const file = await opened('guide.md');
    file.saver.edit(() => 'mine');
    const answer = new Subject<GitMergeState>();
    mergeAnswer = () => answer;

    const { done } = await confirm();
    repository.set({ id: 13 });
    answer.next(conflicting('guide.md'));
    answer.complete();
    await done;

    expect(requests).toEqual([ 'merge' ]);
    expect(own).toEqual([]);
    expect(file.saver.waiting()).toBe('mine');
  });

  it('does not load anything of the other repository after a switch while it aborts', async () => {
    await opened('guide.md');
    const answer = new Subject<void>();
    abortAnswer = () => answer;

    const { done } = await confirm();
    repository.set({ id: 13 });
    answer.complete();
    await done;

    expect(requests).toEqual([ 'abort' ]);
    expect(released).toEqual([ 'guide.md' ]);
  });
});
