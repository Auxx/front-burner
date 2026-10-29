import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type {
  CreateEntryRequest,
  CurrentUser,
  EntryPath,
  EntrySummary,
  FolderListing,
  RenameEntryRequest
} from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, throwError } from 'rxjs';

import { dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { entry, folder, listing } from '../../../testing/listings';
import { translocoTesting } from '../../../testing/transloco-testing';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { FirstFileService } from '../first-file/first-file.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { EntryCommandsService } from './entry-commands.service';

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
  let openPath: string;
  let navigate: ReturnType<typeof vi.fn>;
  let commands: EntryCommandsService;
  let store: FileTreeStoreService;

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
              return renameAnswer(request);
            },
            entrySummary: () => of(summary),
            isIgnored: () => of({ ignored: false })
          }
        }
      ]
    });
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
});
