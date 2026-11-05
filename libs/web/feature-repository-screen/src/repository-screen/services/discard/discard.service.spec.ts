import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type { CurrentUser, FileContent, FileState, GitChange, SaveFileRequest } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { FilesApi, GitApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { MemoryDraftStore, provideMemoryDrafts } from '../../../testing/drafts';
import { fileContent } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { EntryCommandsService, OWN_CHANGE_MS } from '../entry-commands/entry-commands.service';
import { FirstFileService } from '../first-file/first-file.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { DiscardService } from './discard.service';

const K = 'web-feature-repository-screen.DiscardChangesDialog';
const ada = { id: 4 } as CurrentUser;
const RESTORED = 'b'.repeat(64);

const modified = (path: string): GitChange => ({ path, state: 'modified' });
const added = (path: string): GitChange => ({ path, state: 'added' });
const deleted = (path: string): GitChange => ({ path, state: 'deleted' });

describe('DiscardService', () => {
  let service: DiscardService;
  let openFiles: OpenFilesService;
  let drafts: MemoryDraftStore;
  /** Every request that changes or reads files, in order. */
  let requests: string[];
  let discarded: string[][];
  let discardAnswer: (paths: string[]) => Observable<void>;
  let readAnswer: (path: string) => Observable<FileContent>;
  let saves: { request: SaveFileRequest; answer: Subject<FileState>; }[];
  let refresh: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let forgotten: ReturnType<typeof vi.fn>;
  let own: string[];
  let released: string[];
  let routePath: string;
  let repository: ReturnType<typeof signal<{ id: number; }>>;

  /** Asks to discard `changes`, and presses **Discard**. */
  async function confirm(changes: GitChange[]): Promise<{ done: Promise<boolean>; }> {
    const done = service.discard(changes);
    await settleDialog();
    dialogButton(`${K}.discard`)?.click();
    await settleDialog();
    return { done };
  }

  beforeEach(() => {
    drafts = new MemoryDraftStore();
    requests = [];
    discarded = [];
    discardAnswer = () => of(undefined);
    readAnswer = path => of(fileContent(path, { content: 'committed', hash: RESTORED }));
    saves = [];
    refresh = vi.fn(() => Promise.resolve());
    navigate = vi.fn(() => Promise.resolve(true));
    forgotten = vi.fn();
    own = [];
    released = [];
    routePath = '';
    repository = signal({ id: 12 });
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ [`${K}.heading`]: 'Discard {{ count }}' }) ],
      providers: [
        DiscardService,
        OpenFilesService,
        provideMemoryDrafts(drafts),
        { provide: GitStatusStore, useValue: { refresh } },
        { provide: FirstFileService, useValue: { deleted: forgotten } },
        {
          provide: EntryCommandsService,
          useValue: {
            ownChange: (path: string) => {
              own.push(path);
              return () => released.push(path);
            }
          }
        },
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap({ path: routePath }) };
            }
          }
        },
        { provide: RepositorySessionService, useValue: { repository } },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        {
          provide: GitApi,
          useValue: {
            discard: (_id: number, body: { paths: string[]; }) => {
              requests.push('discard');
              discarded.push(body.paths);
              return discardAnswer(body.paths);
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
    service = TestBed.inject(DiscardService);
    openFiles = TestBed.inject(OpenFilesService);
    readAnswer = path => of(fileContent(path));
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  /** Opens `path` as loaded from disk; later reads answer the committed content. */
  async function opened(path: string) {
    const file = await openFiles.open(path);
    requests = [];
    readAnswer = read => of(fileContent(read, { content: 'committed', hash: RESTORED }));
    return file;
  }

  it('AC-GIT-002.8: asks first, then restores a modified file', async () => {
    const done = service.discard([ modified('README.md') ]);
    await settleDialog();

    expect(overlay().querySelector('rs-discard-changes')).not.toBeNull();
    expect(discarded).toEqual([]);

    dialogButton(`${K}.discard`)?.click();

    expect(await done).toBe(true);
    expect(discarded).toEqual([ [ 'README.md' ] ]);
    expect(refresh).toHaveBeenCalled();
  });

  it('AC-GIT-002.8: deletes an added file and closes it', async () => {
    routePath = 'new.md';
    await opened('new.md');

    expect(await (await confirm([ added('new.md') ])).done).toBe(true);

    expect(discarded).toEqual([ [ 'new.md' ] ]);
    expect(openFiles.get('new.md')).toBeUndefined();
    expect(openFiles.current()).toBeNull();
    expect(navigate).toHaveBeenCalledWith([ '/repositories', 12 ], { replaceUrl: true, state: { closed: true } });
    expect(forgotten).toHaveBeenCalledWith(12, 'new.md');
  });

  it('does not leave the open file when an added file that is not open is discarded', async () => {
    routePath = 'README.md';
    await opened('README.md');

    await (await confirm([ added('new.md') ])).done;

    expect(navigate).not.toHaveBeenCalled();
    expect(openFiles.get('README.md')).toBeDefined();
  });

  it('AC-GIT-002.8: restores a deleted file', async () => {
    const file = await opened('gone.md');
    openFiles.markGone('gone.md');

    expect(await (await confirm([ deleted('gone.md') ])).done).toBe(true);

    expect(discarded).toEqual([ [ 'gone.md' ] ]);
    expect(file.gone()).toBe(false);
    expect(file.file.content).toBe('committed');
  });

  it('AC-GIT-002.8: discarding the open file while a save is waiting does not bring the change back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const file = await opened('README.md');
      file.saver.edit(() => 'mine');

      await (await confirm([ modified('README.md') ])).done;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(requests).toEqual([ 'discard', 'read README.md' ]);
      expect(file.saver.unsaved()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a save in flight, so that it cannot land after the discard', async () => {
    const file = await opened('README.md');
    file.saver.edit(() => 'mine');
    void file.saver.flush();
    expect(requests).toEqual([ 'save mine' ]);

    const { done } = await confirm([ modified('README.md') ]);

    expect(requests).toEqual([ 'save mine' ]);

    saves[0].answer.next({ hash: 'c'.repeat(64), size: 4 });
    saves[0].answer.complete();

    expect(await done).toBe(true);
    expect(requests).toEqual([ 'save mine', 'discard', 'read README.md' ]);
    expect(file.saver.unsaved()).toBe(false);
  });

  it('cancelling changes nothing', async () => {
    const file = await opened('README.md');
    file.saver.edit(() => 'mine');
    const done = service.discard([ modified('README.md') ]);
    await settleDialog();

    dialogButton(`${K}.cancel`)?.click();

    expect(await done).toBe(false);
    expect(discarded).toEqual([]);
    expect(file.saver.waiting()).toBe('mine');
    expect(own).toEqual([]);
  });

  it('Discard all sends the paths the list shows and says how many', async () => {
    const done = service.discard([ modified('a.md'), added('b.md'), deleted('c.md') ]);
    await settleDialog();

    expect(overlay().querySelector('h2')?.textContent).toContain(`${K}.headingAll`);

    dialogButton(`${K}.discard`)?.click();
    await done;

    expect(discarded).toEqual([ [ 'a.md', 'b.md', 'c.md' ] ]);
  });

  it('reloads the open file without asking', async () => {
    const file = await opened('README.md');
    const revision = file.revision();
    file.saver.edit(() => 'mine');

    await (await confirm([ modified('README.md') ])).done;

    expect(file.revision()).toBe(revision + 1);
    expect(file.file.content).toBe('committed');
    expect(file.changed()).toBeNull();
  });

  it('marks the open file as changed by this tab, so that its event is not taken for a change elsewhere', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await opened('README.md');

      await (await confirm([ modified('README.md'), modified('other.md') ])).done;

      expect(own).toEqual([ 'README.md' ]);
      expect(released).toEqual([]);
      await vi.advanceTimersByTimeAsync(OWN_CHANGE_MS);
      expect(released).toEqual([ 'README.md' ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes the browser draft of a discarded file', async () => {
    const draft = { content: 'draft', savedAt: new Date().toISOString() };
    const key = (path: string) => ({ userId: 4, repositoryId: 12, path });
    await drafts.put(key('README.md'), draft);
    await drafts.put(key('other.md'), draft);
    await drafts.put(key('kept.md'), draft);
    const file = await opened('README.md');
    expect(file.draft()).not.toBeNull();

    await (await confirm([ modified('README.md'), modified('other.md') ])).done;

    expect(file.draft()).toBeNull();
    expect(drafts.at('README.md')).toBeUndefined();
    expect(drafts.at('other.md')).toBeUndefined();
    expect(drafts.at('kept.md')).toBeDefined();
  });

  it('deletes the open file\'s browser draft before the discard is sent', async () => {
    const draft = { content: 'draft', savedAt: new Date().toISOString() };
    await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, draft);
    await opened('README.md');
    let draftWhenSent: unknown = 'not sent';
    discardAnswer = () => {
      draftWhenSent = drafts.at('README.md');
      return of(undefined);
    };

    await (await confirm([ modified('README.md') ])).done;

    expect(draftWhenSent).toBeUndefined();
  });

  it('leaves the browser draft of a file that another tab has open', async () => {
    const draft = { content: 'draft', savedAt: new Date().toISOString() };
    await drafts.put({ userId: 4, repositoryId: 12, path: 'other.md' }, draft);
    drafts.elsewhere.add('4/12/other.md');

    await (await confirm([ modified('other.md') ])).done;

    expect(drafts.at('other.md')).toBeDefined();
  });

  it('keeps the edits and offers Try again when the discard fails', async () => {
    const file = await opened('README.md');
    file.preview.read = () => 'mine';
    file.saver.edit(() => 'mine');
    discardAnswer = () => throwError(() => new HttpErrorResponse({ status: 0 }));

    const { done } = await confirm([ modified('README.md') ]);

    expect(overlay().querySelector('ui-inline-banner')).not.toBeNull();
    expect(dialogButton(`${K}.retry`)).toBeDefined();
    expect(file.revision()).toBe(0);
    // The editor's content is saved again.
    expect(saves.map(save => save.request.content)).toEqual([ 'mine' ]);
    expect(file.saver.unsaved()).toBe(true);
    expect(released).toContain('README.md');
    expect(refresh).toHaveBeenCalled();
    saves[0].answer.next({ hash: 'c'.repeat(64), size: 4 });
    saves[0].answer.complete();

    discardAnswer = () => of(undefined);
    dialogButton(`${K}.retry`)?.click();

    expect(await done).toBe(true);
    expect(file.file.content).toBe('committed');
    expect(file.saver.unsaved()).toBe(false);
  });

  it('offers a draft again when the discard fails', async () => {
    const draft = { content: 'draft', savedAt: new Date().toISOString() };
    await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, draft);
    const file = await opened('README.md');
    discardAnswer = () => throwError(() => apiError(409, 'discard-blocked'));

    const { done } = await confirm([ modified('README.md') ]);

    expect(file.draft()).toEqual(draft);
    expect(drafts.at('README.md')).toEqual(draft);
    dialogButton(`${K}.cancel`)?.click();
    expect(await done).toBe(false);
  });

  it('keeps the files of a request not sent when one fails, and tries only those again', async () => {
    const changes = Array.from({ length: 10_001 }, (_, index) => modified(`f${index}.md`));
    const file = await opened(changes[0].path);
    const last = await opened(changes[10_000].path);
    last.preview.read = () => 'mine';
    last.saver.edit(() => 'mine');
    let answers = 0;
    discardAnswer = () => (++answers === 2 ? throwError(() => new HttpErrorResponse({ status: 503 })) : of(undefined));

    const { done } = await confirm(changes);

    expect(discarded.map(paths => paths.length)).toEqual([ 10_000, 1 ]);
    expect(file.revision()).toBe(1);
    expect(last.revision()).toBe(0);
    expect(saves.map(save => save.request.content)).toEqual([ 'mine' ]);
    saves[0].answer.next({ hash: 'c'.repeat(64), size: 4 });
    saves[0].answer.complete();
    await settleDialog();

    dialogButton(`${K}.retry`)?.click();

    expect(await done).toBe(true);
    expect(discarded.map(paths => paths.length)).toEqual([ 10_000, 1, 1 ]);
    expect(last.revision()).toBe(1);
  });

  it('holds the old content back from saving when it cannot be read again', async () => {
    const file = await opened('README.md');
    readAnswer = () => throwError(() => new HttpErrorResponse({ status: 0 }));

    expect(await (await confirm([ modified('README.md') ])).done).toBe(true);

    expect(released).toContain('README.md');
    expect(file.changed()).toBe(file.hash());
    file.saver.edit(() => 'typed on the old content');
    void file.saver.flush();
    expect(saves).toEqual([]);
  });

  it('deletes the browser draft of a file at the route that is not open', async () => {
    routePath = 'gone.md';
    await drafts.put({ userId: 4, repositoryId: 12, path: 'gone.md' }, {
      content: 'draft',
      savedAt: new Date().toISOString()
    });

    await (await confirm([ deleted('gone.md') ])).done;

    expect(drafts.at('gone.md')).toBeUndefined();
  });

  it('leaves another repository\'s file at the same path alone when the answer comes after a navigation', async () => {
    await opened('README.md');
    const answer = new Subject<void>();
    discardAnswer = () => answer;
    const { done } = await confirm([ modified('README.md') ]);

    TestBed.inject(DialogService).closeAll();
    expect(await done).toBe(false);
    repository.set({ id: 13 });
    const other = await openFiles.open('README.md');
    other.saver.edit(() => 'mine');
    answer.next();
    answer.complete();
    await settleDialog();

    expect(other.saver.waiting()).toBe('mine');
    expect(other.revision()).toBe(0);
  });

  it('sends no more requests once a navigation closed the dialog', async () => {
    const answer = new Subject<void>();
    discardAnswer = () => answer;
    const { done } = await confirm(Array.from({ length: 10_001 }, (_, index) => modified(`f${index}.md`)));

    TestBed.inject(DialogService).closeAll();
    expect(await done).toBe(false);
    answer.next();
    answer.complete();
    await settleDialog();

    expect(discarded).toHaveLength(1);
  });

  it('closes the open file only after the dialog, whose closing a navigation would answer', async () => {
    routePath = 'image.png';

    expect(await (await confirm([ added('image.png') ])).done).toBe(true);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('runs one discard at a time', async () => {
    const first = service.discard([ modified('a.md') ]);
    await settleDialog();

    expect(await service.discard([ modified('b.md') ])).toBe(false);

    dialogButton(`${K}.cancel`)?.click();
    expect(await first).toBe(false);
  });
});
