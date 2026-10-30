import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type { CurrentUser, FolderListing, PushEvent } from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService, PushChannelService } from '@front-burner/web-core';
import { ImageCache } from '@front-burner/web-markdown/images';
import { Observable, of, Subject, throwError } from 'rxjs';

import { entry, folder, listing } from '../../../testing/listings';
import { fileContent } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DiskChangesService } from '../disk-changes/disk-changes.service';
import { EntryCommandsService } from '../entry-commands/entry-commands.service';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { FirstFileService } from '../first-file/first-file.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { TreeSyncService } from './tree-sync.service';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

const MEMORY = 'fb.4.repo.12.expanded';

/** Lets promise chains and synchronous answers finish. */
const flush = () => new Promise(resolve => setTimeout(resolve));

describe('TreeSyncService', () => {
  /** What the working copy holds, by folder path. */
  let folders: Record<string, FolderListing>;
  /** Answers that come before `folders`, once each. */
  let answers: Record<string, Observable<FolderListing>[]>;
  let listFolder: ReturnType<typeof vi.fn>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  /** How many times the events were subscribed to: each first one opens the push channel. */
  let subscribed: number;
  let openPath: string;
  let session: {
    state: ReturnType<typeof signal<string>>;
    statusChanged: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
  let store: FileTreeStoreService;
  let sync: TreeSyncService;
  let notice: ReturnType<typeof vi.fn>;
  let images: { revalidate: ReturnType<typeof vi.fn>; revalidateFolders: ReturnType<typeof vi.fn>; };

  const listed = () => listFolder.mock.calls.map(([ , query ]) => (query as { path: string; }).path);
  const changed = (folders: string[] | 'all', repositoryId = 12) =>
    events.next({ type: 'files.changed', repositoryId, folders });

  /** Starts on repository 12 with `expanded` remembered, once the tree has loaded. */
  async function start(expanded: string[] = []): Promise<void> {
    localStorage.setItem(MEMORY, JSON.stringify(expanded));
    store.init(12);
    sync.start(12);
    await flush();
    await flush();
    listFolder.mockClear();
  }

  beforeEach(() => {
    localStorage.clear();
    answers = {};
    openPath = '';
    folders = {
      '': listing('', [ folder('docs'), folder('notes'), entry('README.md') ]),
      docs: listing('docs', [ folder('api'), entry('guide.md') ]),
      'docs/api': listing('docs/api', [ entry('index.md') ]),
      notes: listing('notes', [ entry('todo.md') ])
    };
    listFolder = vi.fn((_id: number, query: { path: string; }) => {
      const answer = answers[query.path]?.shift();
      if (answer) {
        return answer;
      }
      const found = folders[query.path];
      return found
        ? of(found)
        : throwError(() =>
          new HttpErrorResponse({
            status: 404,
            error: { code: 'entry-not-found', params: {}, requestId: '', message: 'entry-not-found' }
          })
        );
    });
    events = new Subject();
    reconnected = new Subject();
    subscribed = 0;
    const counted = new Observable<PushEvent>(subscriber => {
      subscribed++;
      return events.subscribe(subscriber);
    });
    session = { state: signal('ready'), statusChanged: vi.fn(), retry: vi.fn(), refresh: vi.fn() };
    notice = vi.fn();
    images = { revalidate: vi.fn(), revalidateFolders: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        TreeSyncService,
        EntryCommandsService,
        FileTreeStoreService,
        FirstFileService,
        { provide: RepositorySessionService, useValue: { ...session, repository: signal({ id: 12 }) } },
        { provide: PushChannelService, useValue: { events: counted, reconnected } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap(openPath ? { path: openPath } : {}) };
            }
          }
        },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        {
          provide: FilesApi,
          useValue: {
            listFolder,
            readFile: (_id: number, query: { path: string; }) => of(fileContent(query.path)),
            recreateFile: () => of({ hash: 'd'.repeat(64), size: 4 })
          }
        },
        OpenFilesService,
        { provide: DiskChangesService, useValue: { notice } },
        { provide: ImageCache, useValue: images },
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: false, breakpoints: {} }), isMatched: () => false }
        }
      ]
    });
    store = TestBed.inject(FileTreeStoreService);
    sync = TestBed.inject(TreeSyncService);
  });

  it('reloads an expanded folder named in an event', async () => {
    await start([ 'docs' ]);
    folders['docs'] = listing('docs', [ folder('api'), entry('guide.md'), entry('new.md') ]);

    changed([ 'docs' ]);
    await flush();

    expect(listed()).toEqual([ 'docs' ]);
    expect(store.entry('docs/new.md')).toBeDefined();
  });

  it('revalidates images when their folder changes', async () => {
    await start([ 'docs' ]);

    changed([ 'docs', 'docs/img' ]);
    changed([ 'notes' ], 13);
    reconnected.next();

    expect(images.revalidateFolders.mock.calls).toEqual([ [ 12, [ 'docs', 'docs/img' ] ] ]);
    expect(images.revalidate.mock.calls).toEqual([ [ 12, 'all' ] ]);
  });

  describe('own saves', () => {
    const OWN = 'a'.repeat(64);
    const saved = (folders: string[], files: { path: string; hash: string; }[]) =>
      events.next({ type: 'files.changed', repositoryId: 12, folders, files });

    beforeEach(async () => {
      await start([ 'docs' ]);
      await TestBed.inject(OpenFilesService).open('docs/guide.md');
    });

    it('skips the event of a save of an open file whose hash matches its last save', async () => {
      saved([ 'docs' ], [ { path: 'docs/guide.md', hash: OWN } ]);
      await flush();

      expect(listed()).toEqual([]);
      expect(images.revalidateFolders).not.toHaveBeenCalled();
    });

    it('lists the folder again for a save made elsewhere', async () => {
      saved([ 'docs' ], [ { path: 'docs/guide.md', hash: 'c'.repeat(64) } ]);
      await flush();

      expect(listed()).toEqual([ 'docs' ]);
    });

    it('lists the folder again for a save of a file that is not open', async () => {
      saved([ '' ], [ { path: 'README.md', hash: OWN } ]);
      await flush();

      expect(listed()).toEqual([ '' ]);
    });

    it('lists other folders the event names', async () => {
      saved([ 'docs', '' ], [ { path: 'docs/guide.md', hash: OWN } ]);
      await flush();

      expect(listed().sort()).toEqual([ '', 'docs' ]);
    });
  });

  describe('the open file', () => {
    beforeEach(async () => {
      await start([ 'docs' ]);
      await TestBed.inject(OpenFilesService).open('docs/guide.md');
    });

    it('is checked with the hash an event names', async () => {
      events.next({
        type: 'files.changed',
        repositoryId: 12,
        folders: [ 'docs' ],
        files: [ { path: 'docs/guide.md', hash: 'c'.repeat(64) } ]
      });
      await flush();

      expect(notice).toHaveBeenCalledWith('docs/guide.md', 'c'.repeat(64));
    });

    it('checks the hash on all', async () => {
      changed('all');
      await flush();

      expect(notice).toHaveBeenCalledWith('docs/guide.md');
    });

    it('checks the hash when only the folder is named', async () => {
      changed([ 'docs' ]);
      await flush();

      expect(notice).toHaveBeenCalledWith('docs/guide.md');
    });

    it('checks the hash after a reconnect', async () => {
      reconnected.next();
      await flush();

      expect(notice).toHaveBeenCalledWith('docs/guide.md');
    });

    it('is not checked for a change to another folder', async () => {
      changed([ 'notes' ]);
      await flush();

      expect(notice).not.toHaveBeenCalled();
    });

    it('is left to the change check when it is gone from the listing', async () => {
      openPath = 'docs/guide.md';
      folders['docs'] = listing('docs', [ folder('api') ]);

      changed([ 'docs' ]);
      await flush();

      expect(sync.goneElsewhere()).toBeNull();
      expect(notice).toHaveBeenCalledWith('docs/guide.md');
    });

    it('lists the folders of a recreated file again, and forgets it was gone', async () => {
      openPath = 'docs/guide.md';
      const openFiles = TestBed.inject(OpenFilesService);
      openFiles.markGone('docs/guide.md');

      await openFiles.recreate('docs/guide.md', () => 'text');
      await flush();

      expect(listed().sort()).toEqual([ '', 'docs' ]);
      expect(sync.goneElsewhere()).toBeNull();
    });
  });

  it('reloads every expanded folder for all', async () => {
    await start([ 'docs', 'docs/api' ]);

    changed('all');
    await flush();

    expect(listed().sort()).toEqual([ '', 'docs', 'docs/api' ]);
  });

  it('ignores collapsed folders', async () => {
    await start([ 'docs', 'notes' ]);
    store.expanded.set([ 'docs' ]);

    changed([ 'notes', 'docs/api' ]);
    await flush();

    expect(listed()).toEqual([]);
  });

  it('ignores other repositories', async () => {
    await start([ 'docs' ]);

    changed([ 'docs' ], 13);
    changed('all', 13);
    events.next({ type: 'repository.status', repositoryId: 13, status: 'error', error: 'working-copy-missing' });
    await flush();

    expect(listed()).toEqual([]);
    expect(session.statusChanged).not.toHaveBeenCalled();
  });

  it('coalesces reloads of one folder', async () => {
    await start([ 'docs' ]);
    const first = new Subject<FolderListing>();
    answers['docs'] = [ first ];

    for (let i = 0; i < 50; i++) {
      changed([ 'docs' ]);
    }
    await flush();
    expect(listed()).toEqual([ 'docs' ]);

    first.next(folders['docs']);
    first.complete();
    await flush();
    await flush();

    // One more after the one in flight, for the events that came meanwhile.
    expect(listed()).toEqual([ 'docs', 'docs' ]);
  });

  it('removes a folder that is gone', async () => {
    await start([ 'docs', 'docs/api' ]);
    delete folders['docs/api'];

    changed([ 'docs/api' ]);
    await flush();
    await flush();

    expect(store.expanded()).toEqual([ 'docs' ]);
    expect(JSON.parse(localStorage.getItem(MEMORY) ?? '[]')).toEqual([ 'docs' ]);
    const docs = store.nodes().find(row => row.path === 'docs');
    const api = docs?.children?.find(row => row.path === 'docs/api');
    // The row stays as the parent lists it, but collapsed and with no error row.
    expect(api?.children).toBeUndefined();
  });

  it('reloads expanded folders after a reconnect', async () => {
    await start([ 'docs', 'notes' ]);

    reconnected.next();
    await flush();

    expect(listed().sort()).toEqual([ '', 'docs', 'notes' ]);
  });

  it('says the open file was deleted elsewhere', async () => {
    openPath = 'docs/guide.md';
    await start([ 'docs' ]);
    folders['docs'] = listing('docs', [ folder('api') ]);

    changed([ 'docs' ]);
    await flush();

    expect(sync.goneElsewhere()).toBe('docs/guide.md');
  });

  it('says the open file was deleted elsewhere with its folder', async () => {
    openPath = 'docs/api/index.md';
    await start([ 'docs', 'docs/api' ]);
    delete folders['docs/api'];
    folders['docs'] = listing('docs', [ entry('guide.md') ]);

    changed([ 'docs', 'docs/api' ]);
    await flush();
    await flush();

    expect(sync.goneElsewhere()).toBe('docs/api/index.md');
  });

  it('does not say a file that was never there was deleted', async () => {
    openPath = 'docs/missing.md';
    await start([ 'docs' ]);

    changed([ 'docs' ]);
    await flush();

    expect(sync.goneElsewhere()).toBeNull();
  });

  it('ignores its own changes when the event comes first', async () => {
    openPath = 'docs/guide.md';
    await start([ 'docs' ]);
    const done = TestBed.inject(EntryCommandsService).ownChange('docs');
    folders['docs'] = listing('docs', [ folder('api') ]);

    changed([ 'docs' ]);
    await flush();
    done();

    expect(sync.goneElsewhere()).toBeNull();
  });

  it('passes on the status of the repository', async () => {
    await start();

    events.next({ type: 'repository.status', repositoryId: 12, status: 'error', error: 'working-copy-missing' });

    expect(session.statusChanged).toHaveBeenCalledWith('error', 'working-copy-missing');
  });

  it('reads the repository\'s status again after a reconnect', async () => {
    await start();

    for (const state of [ 'ready', 'not-openable', 'failed', 'loading' ]) {
      session.state.set(state);
      reconnected.next();
    }

    expect(session.refresh).toHaveBeenCalledTimes(2);
    expect(session.retry).toHaveBeenCalledTimes(1);
  });

  it('leaves a folder that failed to Try again', async () => {
    answers['notes'] = [ throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'internal' } })) ];
    await start([ 'notes' ]);

    changed('all');
    reconnected.next();
    await flush();

    expect(listed()).toContain('');
    expect(listed()).not.toContain('notes');
  });

  it('does not list again a folder this tab is renaming or deleting', async () => {
    await start([ 'docs', 'docs/api' ]);
    const done = TestBed.inject(EntryCommandsService).ownChange('docs');

    changed([ '', 'docs', 'docs/api' ]);
    reconnected.next();
    await flush();
    done();

    expect(listed()).toContain('');
    expect(listed().filter(folder => folder.startsWith('docs'))).toEqual([]);
  });

  it('follows a repository once, however often it is started', async () => {
    await start();

    sync.start(12);
    sync.start(12);

    expect(subscribed).toBe(1);
  });

  it('lists nothing while the repository cannot be opened', async () => {
    await start([ 'docs' ]);
    session.state.set('not-openable');

    changed([ 'docs' ]);
    reconnected.next();
    await flush();

    expect(listed()).toEqual([]);
  });

  it('lists a collapsed folder again once it is expanded', async () => {
    await start([ 'docs' ]);
    store.expanded.set([]);
    folders['docs'] = listing('docs', [ folder('api'), entry('guide.md'), entry('new.md') ]);

    changed([ 'docs' ]);
    await flush();

    expect(listed()).toEqual([]);
    // Its stale listing is dropped, so that the tree asks for it when it is expanded.
    expect(store.nodes().find(row => row.path === 'docs')?.children).toBeUndefined();
  });

  it('keeps the open file in a collapsed folder', async () => {
    openPath = 'docs/guide.md';
    await start([ 'docs' ]);
    store.expanded.set([]);

    changed('all');
    await flush();

    expect(sync.goneElsewhere()).toBeNull();
  });

  it('answers the listings on their way when the tree is reset', async () => {
    await start([ 'docs' ]);
    answers['docs'] = [ new Subject<FolderListing>() ];
    void store.load('docs');
    const found = store.lookup('docs/guide.md');

    store.reset();

    await expect(found).resolves.toBeUndefined();
  });

  it('keeps a folder whose listing was dropped while it was listed again', async () => {
    await start([ 'docs', 'docs/api' ]);
    answers['docs'] = [ new Subject<FolderListing>() ];
    changed([ 'docs' ]);
    await flush();

    // Collapsed while it is listed again: the next event drops its listing.
    store.expanded.set([ 'docs/api' ]);
    changed([ 'docs' ]);
    await flush();

    expect(store.expanded()).toEqual([ 'docs/api' ]);
  });
});
