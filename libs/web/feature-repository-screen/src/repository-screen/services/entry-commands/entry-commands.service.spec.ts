import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type {
  CreateEntryRequest,
  CurrentUser,
  EntryPath,
  EntrySummary,
  FileState,
  FolderListing,
  RenameEntryRequest,
  SaveFileRequest
} from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { entry, folder, listing } from '../../../testing/listings';
import { fileContent } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { FirstFileService } from '../first-file/first-file.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { EntryCommandsService, OWN_CHANGE_MS } from './entry-commands.service';

const P = 'web-feature-repository-screen';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

describe('EntryCommandsService', () => {
  let folders: Record<string, FolderListing>;
  let created: CreateEntryRequest[];
  let renamed: RenameEntryRequest[];
  let renameAnswer: (request: RenameEntryRequest) => Observable<EntryPath>;
  let summary: EntrySummary;
  let summaryAnswer: () => Observable<EntrySummary>;
  let deleted: string[];
  let deleteAnswer: () => Observable<void>;
  let openPath: string;
  let navigate: ReturnType<typeof vi.fn>;
  let commands: EntryCommandsService;
  let store: FileTreeStoreService;
  let openFiles: OpenFilesService;
  /** The requests that change files, in order. */
  let requests: string[];
  let saveAnswer: () => Observable<FileState>;

  /** Runs a command while the user answers its dialogs with `answer`. */
  async function run(
    action: Parameters<EntryCommandsService['run']>[0],
    path: string,
    answer: () => Promise<void>
  ): Promise<string | null> {
    const done = commands.run(action, path);
    await settleDialog();
    await answer();
    const opened = await done;
    await settleDialog();
    return opened;
  }

  const confirmation = () => overlay().querySelector('ui-confirm-dialog');

  beforeEach(async () => {
    localStorage.clear();
    openPath = '';
    created = [];
    renamed = [];
    summary = { files: 3, nonMarkdown: 0, uncommitted: 0 };
    summaryAnswer = () => of(summary);
    deleted = [];
    deleteAnswer = () => of(undefined);
    requests = [];
    saveAnswer = () => of({ hash: 'b'.repeat(64), size: 10 });
    renameAnswer = request => {
      const slash = request.path.lastIndexOf('/');
      return of({ path: slash === -1 ? request.name : `${request.path.slice(0, slash)}/${request.name}` });
    };
    folders = {
      '': listing('', [ folder('docs'), folder('build', { ignored: true }), entry('README.md') ]),
      docs: listing('docs', [ folder('api'), entry('guide.md') ]),
      'docs/api': listing('docs/api', [ entry('index.md') ]),
      build: listing('build', [], { ignored: true })
    };
    navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${P}.EntryCommandsService.renameFolder.message`]: '{{ count }} non-Markdown files move with this folder.'
        })
      ],
      providers: [
        EntryCommandsService,
        FileTreeStoreService,
        FirstFileService,
        { provide: RepositorySessionService, useValue: { repository: signal({ id: 12 }) } },
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap({ path: openPath }) };
            }
          }
        },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        {
          provide: FilesApi,
          useValue: {
            listFolder: (_id: number, query: { path: string; }) =>
              folders[query.path] ? of(folders[query.path]) : throwError(() => new Error('missing')),
            createEntry: (_id: number, request: CreateEntryRequest) => {
              created.push(request);
              const name = request.kind === 'file' && !request.name.endsWith('.md')
                ? `${request.name}.md`
                : request.name;
              return of({ path: request.folder === '' ? name : `${request.folder}/${name}` });
            },
            renameEntry: (_id: number, request: RenameEntryRequest) => {
              renamed.push(request);
              requests.push(`rename ${request.path}`);
              return renameAnswer(request);
            },
            entrySummary: () => summaryAnswer(),
            deleteEntry: (_id: number, query: { path: string; }) => {
              deleted.push(query.path);
              return deleteAnswer();
            },
            isIgnored: () => of({ ignored: false }),
            readFile: (_id: number, query: { path: string; }) => of(fileContent(query.path)),
            saveFile: (_id: number, request: SaveFileRequest) => {
              requests.push(`save ${request.path}`);
              return saveAnswer();
            }
          }
        },
        OpenFilesService,
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: false, breakpoints: {} }), isMatched: () => false }
        }
      ]
    });
    openFiles = TestBed.inject(OpenFilesService);
    commands = TestBed.inject(EntryCommandsService);
    store = TestBed.inject(FileTreeStoreService);
    store.init(12);
    await store.resolve('docs/api/index.md');
  });

  afterEach(() => {
    TestBed.inject(DialogService).closeAll();
    localStorage.clear();
  });

  it('opens a new file after creating it', async () => {
    const opened = await run('new-file', 'docs', async () => {
      type(nameInput(), 'notes');
      dialogButton(`${P}.EntryNameDialog.submit.create`)?.click();
    });

    expect(created).toEqual([ { folder: 'docs', name: 'notes', kind: 'file' } ]);
    expect(navigate).toHaveBeenCalledWith([ '/repositories', 12, 'files', 'docs', 'notes.md' ], { replaceUrl: false });
    expect(opened).toBe('docs/notes.md');
  });

  it('warns about an ignored folder before creating in it', async () => {
    await run('new-file', 'build', async () => {
      expect(overlay().querySelector('ui-inline-banner')?.textContent?.trim()).toBe(
        `${P}.EntryNameDialog.ignored.file`
      );
      dialogButton(`${P}.EntryNameDialog.cancel`)?.click();
    });

    expect(created).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('expands a new folder', async () => {
    folders[''] = listing('', [ ...folders[''].entries, folder('drafts', { empty: true }) ]);
    folders['drafts'] = listing('drafts', []);
    const focusRequests: (string | null)[] = [];

    const opened = await run('new-folder', '', async () => {
      type(nameInput(), 'drafts');
      dialogButton(`${P}.EntryNameDialog.submit.create`)?.click();
    });
    focusRequests.push(store.focusRequest());

    expect(created).toEqual([ { folder: '', name: 'drafts', kind: 'folder' } ]);
    expect(store.expanded()).toContain('drafts');
    expect(focusRequests).toEqual([ 'drafts' ]);
    expect(navigate).not.toHaveBeenCalled();
    expect(opened).toBeNull();
  });

  it('asks a second time before renaming a folder with images', async () => {
    summary = { files: 5, nonMarkdown: 2, uncommitted: 0 };

    await run('rename', 'docs', async () => {
      type(nameInput(), 'guides');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
      await settleDialog();
      expect(confirmation()?.textContent).toContain('2 non-Markdown files move with this folder.');
      expect(renamed).toEqual([]);
      dialogButton(`${P}.EntryCommandsService.renameFolder.confirm`)?.click();
    });

    expect(renamed).toEqual([ { path: 'docs', name: 'guides' } ]);
  });

  it('renames a folder without images at once', async () => {
    await run('rename', 'docs', async () => {
      type(nameInput(), 'guides');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
      await settleDialog();
      expect(confirmation()).toBeNull();
    });

    expect(renamed).toEqual([ { path: 'docs', name: 'guides' } ]);
  });

  it('cancels a folder rename at the second confirmation', async () => {
    summary = { files: 5, nonMarkdown: 1, uncommitted: 0 };
    const done = commands.run('rename', 'docs');
    await settleDialog();
    type(nameInput(), 'guides');
    dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    await settleDialog();

    dialogButton(`${P}.EntryCommandsService.renameFolder.cancel`)?.click();
    await settleDialog();

    expect(renamed).toEqual([]);
    expect(confirmation()).toBeNull();
    expect(nameInput().value).toBe('guides');
    expect(store.expanded()).toEqual([ 'docs', 'docs/api' ]);

    dialogButton(`${P}.EntryNameDialog.cancel`)?.click();
    await done;
  });

  it('follows the open file into a renamed folder', async () => {
    openPath = 'docs/api/index.md';
    folders[''] = listing('', [ folder('guides'), folder('build', { ignored: true }), entry('README.md') ]);
    folders['guides'] = listing('guides', folders['docs'].entries);
    folders['guides/api'] = listing('guides/api', folders['docs/api'].entries);

    await run('rename', 'docs', async () => {
      type(nameInput(), 'guides');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    });

    expect(navigate).toHaveBeenCalledWith([ '/repositories', 12, 'files', 'guides', 'api', 'index.md' ], {
      replaceUrl: true
    });
    expect(store.expanded()).toEqual([ 'guides', 'guides/api' ]);
    expect(store.nodes().map(row => row.label)).toEqual([ 'guides', 'build', 'README.md' ]);
  });

  it('keeps a renamed open file open', async () => {
    openPath = 'docs/guide.md';
    localStorage.setItem('fb.4.repo.12.lastFile', 'docs/guide.md');

    await run('rename', 'docs/guide.md', async () => {
      type(nameInput(), 'intro.md');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    });

    expect(renamed).toEqual([ { path: 'docs/guide.md', name: 'intro.md' } ]);
    expect(navigate).toHaveBeenCalledWith([ '/repositories', 12, 'files', 'docs', 'intro.md' ], { replaceUrl: true });
    expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBe('docs/intro.md');
  });

  it('flushes before a rename', async () => {
    openPath = 'docs/guide.md';
    const file = await openFiles.open('docs/guide.md');
    file.saver.edit(() => 'typed just before');
    const save = new Subject<FileState>();
    saveAnswer = () => save;

    const done = commands.run('rename', 'docs/guide.md');
    await settleDialog();
    // Sent at once when the rename starts.
    expect(requests).toEqual([ 'save docs/guide.md' ]);
    type(nameInput(), 'intro.md');
    dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    await settleDialog();
    // The rename waits for the save.
    expect(requests).toEqual([ 'save docs/guide.md' ]);

    save.next({ hash: 'b'.repeat(64), size: 17 });
    save.complete();
    await done;

    expect(requests).toEqual([ 'save docs/guide.md', 'rename docs/guide.md' ]);
    expect(file.saver.lastSaved().content).toBe('typed just before');
    expect(openFiles.get('docs/intro.md')).toBe(file);
    expect(file.path()).toBe('docs/intro.md');
    expect(openFiles.get('docs/guide.md')).toBeUndefined();
  });

  it('sends no save to the old path while the rename is sent', async () => {
    openPath = 'docs/guide.md';
    const file = await openFiles.open('docs/guide.md');
    file.saver.edit(() => 'typed offline');
    saveAnswer = () => throwError(() => new HttpErrorResponse({ status: 0 }));
    const rename = new Subject<EntryPath>();
    renameAnswer = () => rename;

    const done = commands.run('rename', 'docs/guide.md');
    await settleDialog();
    type(nameInput(), 'intro.md');
    dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    await settleDialog();
    expect(requests).toEqual([ 'save docs/guide.md', 'save docs/guide.md', 'rename docs/guide.md' ]);
    // Past the retry's delay (2 s after the second failure), with the rename still in flight.
    await new Promise(resolve => setTimeout(resolve, 2100));
    expect(requests).toHaveLength(3);

    saveAnswer = () => of({ hash: 'b'.repeat(64), size: 13 });
    rename.next({ path: 'docs/intro.md' });
    rename.complete();
    await done;
    await settleDialog();

    expect(requests).toEqual([
      'save docs/guide.md',
      'save docs/guide.md',
      'rename docs/guide.md',
      'save docs/intro.md'
    ]);
    expect(file.saver.status()).toEqual({ kind: 'saved' });
  });

  it('moves the open files under a renamed folder', async () => {
    const file = await openFiles.open('docs/api/index.md');

    await run('rename', 'docs', async () => {
      type(nameInput(), 'guides');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    });

    expect(openFiles.get('guides/api/index.md')).toBe(file);
  });

  /** The function a command set to run {@link OWN_CHANGE_MS} after its answer. */
  const ownChangeEnd = (timers: { mock: { calls: unknown[][]; }; }) =>
    [ ...timers.mock.calls ].reverse().find(([ , delay ]: unknown[]) => delay === OWN_CHANGE_MS)?.[0] as () => void;

  it('counts a rename as its own change until shortly after its answer', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');

    await run('rename', 'docs', async () => {
      // Not while the dialog is open: changes made elsewhere meanwhile are followed.
      expect(commands.isOwnChange('docs/guide.md')).toBe(false);
      type(nameInput(), 'manual');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    });

    expect(commands.isOwnChange('docs/guide.md')).toBe(true);
    expect(commands.isOwnChange('README.md')).toBe(false);
    ownChangeEnd(timers)();
    expect(commands.isOwnChange('docs/guide.md')).toBe(false);
  });

  it('does not count a rename that failed as a change', async () => {
    renameAnswer = () => throwError(() => apiError(500, 'internal'));

    await run('rename', 'docs/guide.md', async () => {
      type(nameInput(), 'intro.md');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
      await settleDialog();
      expect(commands.isOwnChange('docs/guide.md')).toBe(false);
      dialogButton(`${P}.EntryNameDialog.cancel`)?.click();
    });

    expect(commands.isOwnChange('docs/guide.md')).toBe(false);
  });

  it('leaves the route alone when another entry is renamed', async () => {
    openPath = 'README.md';

    await run('rename', 'docs/guide.md', async () => {
      type(nameInput(), 'intro.md');
      dialogButton(`${P}.EntryNameDialog.submit.rename`)?.click();
    });

    expect(renamed).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores another action while one runs', async () => {
    const first = commands.run('new-file', '');
    const second = await commands.run('new-folder', '');
    await settleDialog();

    expect(second).toBeNull();
    expect(overlay().querySelectorAll('rs-entry-name')).toHaveLength(1);

    dialogButton(`${P}.EntryNameDialog.cancel`)?.click();
    await first;
    await settleDialog();

    const third = commands.run('new-folder', '');
    await settleDialog();
    expect(overlay().querySelectorAll('rs-entry-name')).toHaveLength(1);
    dialogButton(`${P}.EntryNameDialog.cancel`)?.click();
    await third;
  });

  it('finds a new file beyond a long folder\'s listed entries (FB-18)', async () => {
    folders['docs'] = listing('docs', [ folder('api'), entry('guide.md') ], { more: 6000 });
    await store.load('docs');

    await run('new-file', 'docs', async () => {
      type(nameInput(), 'zzz');
      dialogButton(`${P}.EntryNameDialog.submit.create`)?.click();
    });

    expect(await store.resolve('docs/zzz.md')).toMatchObject({ name: 'zzz.md', kind: 'file', markdown: true });
  });

  describe('delete', () => {
    const D = `${P}.DeleteEntryDialog`;

    it('deletes an entry and lists its folder again', async () => {
      folders['docs'] = listing('docs', [ folder('api') ]);

      await run('delete', 'docs/guide.md', async () => {
        dialogButton(`${D}.delete`)?.click();
      });

      expect(deleted).toEqual([ 'docs/guide.md' ]);
      expect(store.entry('docs/guide.md')).toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('counts a delete as its own change until shortly after its answer', async () => {
      const timers = vi.spyOn(globalThis, 'setTimeout');

      await run('delete', 'docs/guide.md', async () => {
        expect(commands.isOwnChange('docs/guide.md')).toBe(false);
        dialogButton(`${D}.delete`)?.click();
      });

      expect(commands.isOwnChange('docs/guide.md')).toBe(true);
      ownChangeEnd(timers)();
      expect(commands.isOwnChange('docs/guide.md')).toBe(false);
    });

    it('does not count a cancelled delete as a change', async () => {
      await run('delete', 'docs/guide.md', async () => {
        dialogButton(`${D}.cancel`)?.click();
      });
      await new Promise(resolve => setTimeout(resolve));

      expect(commands.isOwnChange('docs/guide.md')).toBe(false);
    });

    it('does not delete without a summary', async () => {
      summaryAnswer = () => throwError(() => apiError(500, 'internal'));

      await run('delete', 'docs/guide.md', async () => {
        expect(dialogButton(`${D}.delete`)).toBeUndefined();
        expect(dialogButton(`${D}.retry`)).toBeDefined();
        dialogButton(`${D}.cancel`)?.click();
      });

      expect(deleted).toEqual([]);
    });

    it('restores the row when the delete fails', async () => {
      const answer = new Subject<void>();
      deleteAnswer = () => answer;
      const done = commands.run('delete', 'docs/guide.md');
      await settleDialog();

      dialogButton(`${D}.delete`)?.click();
      await settleDialog();
      const row = () =>
        store.nodes().find(item => item.path === 'docs')?.children?.find(item => item.label === 'guide.md');
      expect(row()?.deleting).toBe(true);

      answer.error(apiError(409, 'merge-in-progress'));
      await settleDialog();

      expect(row()?.deleting).toBe(false);
      expect(overlay().querySelector('rs-delete-entry')).not.toBeNull();
      dialogButton(`${D}.cancel`)?.click();
      await done;
    });

    it('shows the empty state after deleting the open file\'s folder', async () => {
      openPath = 'docs/api/index.md';
      localStorage.setItem('fb.4.repo.12.lastFile', 'docs/api/index.md');
      folders[''] = listing('', [ folder('build', { ignored: true }), entry('README.md') ]);

      await run('delete', 'docs', async () => {
        dialogButton(`${D}.delete`)?.click();
      });

      expect(deleted).toEqual([ 'docs' ]);
      // The page shows the empty state, not the README, for this navigation (FB-39).
      expect(navigate).toHaveBeenCalledWith([ '/repositories', 12 ], { replaceUrl: true, state: { closed: true } });
      expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBeNull();
      expect(store.expanded()).toEqual([]);
      expect(await TestBed.inject(FirstFileService).pick(12)).toBe('README.md');
    });

    it('drops the waiting save when the file is deleted', async () => {
      openPath = 'docs/guide.md';
      const file = await openFiles.open('docs/guide.md');
      file.saver.edit(() => 'typed just before');

      await run('delete', 'docs', async () => {
        dialogButton(`${D}.delete`)?.click();
      });
      await file.saver.flush();

      expect(requests).toEqual([]);
      expect(file.saver.unsaved()).toBe(false);
      expect(openFiles.get('docs/guide.md')).toBeUndefined();
      expect(openFiles.anyUnsaved()).toBe(false);
    });

    it('keeps the open file when another entry is deleted', async () => {
      openPath = 'README.md';
      localStorage.setItem('fb.4.repo.12.lastFile', 'README.md');

      await run('delete', 'docs', async () => {
        dialogButton(`${D}.delete`)?.click();
      });

      expect(navigate).not.toHaveBeenCalled();
      expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBe('README.md');
      expect(await TestBed.inject(FirstFileService).pick(12)).toBe('README.md');
    });

    it('closes the open file before forgetting it', async () => {
      openPath = 'docs/guide.md';
      localStorage.setItem('fb.4.repo.12.lastFile', 'docs/guide.md');
      let remembered: string | null | undefined;
      navigate.mockImplementation(() => {
        remembered = localStorage.getItem('fb.4.repo.12.lastFile');
        return Promise.resolve(true);
      });

      await run('delete', 'docs/guide.md', async () => {
        dialogButton(`${D}.delete`)?.click();
      });

      // Navigated at once, without waiting for the user to load.
      expect(remembered).toBe('docs/guide.md');
      expect(localStorage.getItem('fb.4.repo.12.lastFile')).toBeNull();
    });

    it.each([
      [ 'docs/guide.md', 'docs/api' ],
      [ 'docs/api', 'docs/guide.md' ],
      [ 'docs/api/index.md', 'docs/api' ]
    ])('moves the focus after deleting %s to %s', async (path, focused) => {
      const folderPath = path.slice(0, path.lastIndexOf('/'));
      const name = path.slice(path.lastIndexOf('/') + 1);
      folders[folderPath] = listing(folderPath, folders[folderPath].entries.filter(item => item.name !== name));

      await run('delete', path, async () => {
        dialogButton(`${D}.delete`)?.click();
      });

      expect(store.focusRequest()).toBe(focused);
    });

    it('deletes an entry whose folder is being listed again', async () => {
      const pending = new Subject<FolderListing>();
      const listFolder = TestBed.inject(FilesApi).listFolder as unknown as (
        id: number,
        query: { path: string; }
      ) => Observable<FolderListing>;
      TestBed.inject(FilesApi).listFolder =
        ((id: number, query: { path: string; }) => query.path === 'docs' ? pending : listFolder(id, query)) as never;
      void store.load('docs');

      const done = commands.run('delete', 'docs/intro.md');
      pending.next(listing('docs', [ folder('api'), entry('guide.md'), entry('intro.md') ]));
      pending.complete();
      TestBed.inject(FilesApi).listFolder = listFolder as never;
      await settleDialog();

      expect(overlay().querySelector('rs-delete-entry h2')?.textContent).toContain(`${D}.heading`);
      dialogButton(`${D}.cancel`)?.click();
      await done;
    });
  });

  it('renames an entry whose folder is being listed again', async () => {
    const pending = new Subject<FolderListing>();
    const listFolder = TestBed.inject(FilesApi).listFolder as unknown as (
      id: number,
      query: { path: string; }
    ) => Observable<FolderListing>;
    TestBed.inject(FilesApi).listFolder =
      ((id: number, query: { path: string; }) => query.path === 'docs' ? pending : listFolder(id, query)) as never;
    void store.load('docs');

    const done = commands.run('rename', 'docs/intro.md');
    pending.next(listing('docs', [ folder('api'), entry('guide.md'), entry('intro.md') ]));
    pending.complete();
    TestBed.inject(FilesApi).listFolder = listFolder as never;
    await settleDialog();

    expect(nameInput().value).toBe('intro.md');
    dialogButton(`${P}.EntryNameDialog.cancel`)?.click();
    await done;
  });
});
