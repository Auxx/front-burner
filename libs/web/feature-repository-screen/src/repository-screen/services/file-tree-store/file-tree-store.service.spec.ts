import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser, FolderListing } from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { entry, folder, listing } from '../../../testing/listings';
import { translocoTesting } from '../../../testing/transloco-testing';
import type { TreeEntry } from '../../models/tree-entry.model';
import { FileTreeStoreService } from './file-tree-store.service';

const K = 'web-feature-repository-screen.FileTreeStoreService';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

const texts = {
  [`${K}.folder`]: 'folder',
  [`${K}.file`]: 'file',
  [`${K}.symlink`]: 'symbolic link',
  [`${K}.submodule`]: 'submodule',
  [`${K}.markdown`]: 'Markdown',
  [`${K}.ignored`]: 'ignored',
  [`${K}.empty`]: 'empty',
  [`${K}.loading`]: 'Loading…',
  [`${K}.loadFailed`]: 'This folder could not be loaded',
  [`${K}.retry`]: 'Try again',
  // The application formats the ICU message; the spec checks the count reaches it.
  [`${K}.more`]: '{{ count }} more items not shown',
  [`${K}.deleting`]: 'Deleting…',
  [`${K}.emptyNote`]: 'Empty folders aren\'t saved in git. Add a file to keep this folder.'
};

const MEMORY = 'fb.4.repo.12.expanded';

function failure(status: number, code: string): Observable<never> {
  return throwError(() => new HttpErrorResponse({ status, error: { code, params: {}, requestId: '', message: code } }));
}

/** Lets promise chains and synchronous answers finish. */
const flush = () => new Promise(resolve => setTimeout(resolve));

describe('FileTreeStoreService', () => {
  /** What the working copy holds, by folder path. */
  let folders: Record<string, FolderListing>;
  /** Answers that come before `folders`, once each. */
  let answers: Record<string, Observable<FolderListing>[]>;
  let listFolder: ReturnType<typeof vi.fn>;
  let store: FileTreeStoreService;

  const listed = () => listFolder.mock.calls.map(([ , query ]) => (query as { path: string; }).path);
  const find = (nodes: readonly TreeEntry[], value: string): TreeEntry | undefined => {
    for (const node of nodes) {
      if (node.value === value) {
        return node;
      }
      const found = find(node.children ?? [], value);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  const node = (value: string) => find(store.nodes(), value);
  const labels = (nodes: readonly TreeEntry[] | undefined) => nodes?.map(item => item.label);

  beforeEach(() => {
    localStorage.clear();
    answers = {};
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
      return found ? of(found) : failure(404, 'entry-not-found');
    });
    TestBed.configureTestingModule({
      imports: [ translocoTesting(texts) ],
      providers: [
        FileTreeStoreService,
        { provide: FilesApi, useValue: { listFolder } },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } }
      ]
    });
    store = TestBed.inject(FileTreeStoreService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('loads the root and remembered folders', async () => {
    localStorage.setItem(MEMORY, JSON.stringify([ 'docs/api', 'docs' ]));

    store.init(12);
    await flush();

    expect(listed()).toEqual([ '', 'docs', 'docs/api' ]);
    expect(listFolder).toHaveBeenCalledWith(12, { path: 'docs' });
    expect(store.expanded()).toEqual([ 'docs', 'docs/api' ]);
    expect(labels(store.nodes())).toEqual([ 'docs', 'notes', 'README.md' ]);
    expect(labels(node('docs')?.children)).toEqual([ 'api', 'guide.md' ]);
    expect(labels(node('docs/api')?.children)).toEqual([ 'index.md' ]);
    expect(node('docs/api/index.md')?.path).toBe('docs/api/index.md');
    // Folders not yet expanded are left for the tree to ask for.
    expect(node('notes')?.children).toBeUndefined();
  });

  it('drops remembered folders that are gone', async () => {
    // A folder deleted between its parent's listing and its own.
    folders[''].entries.push(folder('vanished'));
    localStorage.setItem(MEMORY, JSON.stringify([ 'docs', 'gone', 'gone/deeper', 'README.md', 'vanished' ]));

    store.init(12);
    await flush();
    TestBed.tick();

    expect(store.expanded()).toEqual([ 'docs' ]);
    expect(listed()).toEqual([ '', 'docs', 'vanished' ]);
    expect(node('\u0000error:vanished')).toBeUndefined();
    expect(node('vanished')?.children).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(MEMORY) ?? 'null')).toEqual([ 'docs' ]);
  });

  it('remembers expanded folders per user and repository', async () => {
    store.init(12);
    await flush();

    store.expanded.set([ 'notes' ]);
    TestBed.tick();

    expect(JSON.parse(localStorage.getItem(MEMORY) ?? 'null')).toEqual([ 'notes' ]);
  });

  it('works without localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    store.init(12);
    await flush();
    store.expanded.set([ 'notes' ]);

    expect(() => TestBed.tick()).not.toThrow();
    expect(labels(store.nodes())).toEqual([ 'docs', 'notes', 'README.md' ]);
  });

  it('shows a loading row while a folder loads', async () => {
    const answer = new Subject<FolderListing>();
    answers['docs'] = [ answer ];
    store.init(12);
    await flush();

    store.load('docs');

    expect(node('docs')?.children).toEqual([
      expect.objectContaining({ value: '\u0000loading:docs', kind: 'loading', label: 'Loading…', selectable: false })
    ]);

    answer.next(folders['docs']);
    expect(labels(node('docs')?.children)).toEqual([ 'api', 'guide.md' ]);
  });

  it('shows a loading row for the root', () => {
    answers[''] = [ new Subject() ];

    store.init(12);

    return flush().then(() => {
      expect(store.nodes()).toEqual([ expect.objectContaining({ kind: 'loading', value: '\u0000loading:' }) ]);
    });
  });

  it('retries one folder without touching the others', async () => {
    localStorage.setItem(MEMORY, JSON.stringify([ 'docs', 'notes' ]));
    answers['notes'] = [ failure(500, 'internal') ];
    store.init(12);
    await flush();

    expect(node('notes')?.children).toEqual([
      expect.objectContaining({
        value: '\u0000error:notes',
        kind: 'error',
        path: 'notes',
        label: 'This folder could not be loaded',
        accessibleName: 'This folder could not be loaded, Try again',
        selectable: true
      })
    ]);
    const docs = node('docs')?.children;

    store.load('notes');

    expect(labels(node('notes')?.children)).toEqual([ 'todo.md' ]);
    expect(node('docs')?.children).toEqual(docs);
    expect(store.expanded()).toEqual([ 'docs', 'notes' ]);
    expect(listed().filter(path => path === 'docs')).toHaveLength(1);
  });

  it('keeps only the answer to the latest request for a folder', async () => {
    const first = new Subject<FolderListing>();
    answers['notes'] = [ first ];
    store.init(12);
    await flush();
    store.load('notes');
    store.load('notes');

    first.next(listing('notes', [ entry('old.md') ]));

    expect(labels(node('notes')?.children)).toEqual([ 'todo.md' ]);
  });

  it('adds a more row with the count', async () => {
    folders[''] = { ...folders[''], more: 1000 };

    store.init(12);
    await flush();

    expect(store.nodes()[store.nodes().length - 1]).toEqual(
      expect.objectContaining({
        value: '\u0000more:',
        kind: 'more',
        label: '1000 more items not shown',
        selectable: false
      })
    );
  });

  it('adds the empty-folder note to an expanded empty folder', async () => {
    folders[''].entries.push(folder('drafts', { empty: true }));
    folders['drafts'] = listing('drafts', []);
    store.init(12);
    await flush();

    store.load('drafts');

    expect(node('drafts')?.children).toEqual([
      expect.objectContaining({
        value: '\u0000empty-note:drafts',
        kind: 'empty-note',
        label: 'Empty folders aren\'t saved in git. Add a file to keep this folder.',
        selectable: false
      })
    ]);
  });

  it('composes accessible names from kind and flags', async () => {
    folders[''] = listing('', [
      folder('build', { ignored: true, empty: true }),
      folder('docs'),
      entry('guide.md'),
      entry('debug.log', { ignored: true }),
      entry('latest', { kind: 'symlink', size: null }),
      entry('vendor', { kind: 'submodule', size: null })
    ]);

    store.init(12);
    await flush();

    expect(store.nodes().map(item => item.accessibleName)).toEqual([
      'build, folder, ignored, empty',
      'docs, folder',
      'guide.md, file, Markdown',
      'debug.log, file, ignored',
      'latest, symbolic link',
      'vendor, submodule'
    ]);
    expect(store.nodes().map(item => [ item.kind, item.expandable, item.selectable ])).toEqual([
      [ 'folder', true, false ],
      [ 'folder', true, false ],
      [ 'file', false, true ],
      [ 'file', false, true ],
      [ 'symlink', false, true ],
      // A submodule cannot be expanded (FB-23).
      [ 'submodule', false, true ]
    ]);
  });

  it('resolves a nested path by loading and expanding its ancestors', async () => {
    store.init(12);

    const found = await store.resolve('docs/api/index.md');

    expect(found).toEqual(entry('index.md'));
    expect(store.expanded()).toEqual([ 'docs', 'docs/api' ]);
    expect(store.entry('docs/api/index.md')).toEqual(entry('index.md'));
    expect(store.entry('docs/guide.md')).toEqual(entry('guide.md'));
    expect(store.entry('notes/todo.md')).toBeUndefined();
    expect(listed()).toEqual([ '', 'docs', 'docs/api' ]);
  });

  it.each([ 'nope/x.md', 'docs/nope.md', 'README.md/x.md', 'docs/api/index.md/x' ])(
    'resolves the missing path %j to null',
    async path => {
      store.init(12);

      expect(await store.resolve(path)).toBeNull();
      expect(node('\u0000error:nope')).toBeUndefined();
    }
  );

  it('resolves to failed when a folder on the way cannot be listed', async () => {
    answers['docs'] = [ failure(500, 'internal') ];
    store.init(12);

    expect(await store.resolve('docs/api/index.md')).toBe('failed');
    // It stays failed until Try again lists it.
    expect(await store.resolve('docs/api/index.md')).toBe('failed');
    store.load('docs');
    expect(await store.resolve('docs/api/index.md')).toEqual(entry('index.md'));
  });

  it('resolves a path again without listing its folders again', async () => {
    store.init(12);
    await store.resolve('docs/guide.md');
    await store.resolve('docs/api/index.md');

    expect(listed()).toEqual([ '', 'docs', 'docs/api' ]);
  });

  it('gives a folder\'s entries once it is listed, or null when it cannot be', async () => {
    store.init(12);

    expect(await store.entries('')).toEqual(folders[''].entries);
    expect(await store.entries('nope')).toBeNull();
    expect(listed()).toEqual([ '', 'nope' ]);
  });

  it('starts over for another repository', async () => {
    localStorage.setItem(MEMORY, JSON.stringify([ 'docs' ]));
    store.init(12);
    await flush();

    folders[''] = listing('', [ entry('other.md') ]);
    store.init(13);
    await flush();

    expect(listFolder).toHaveBeenLastCalledWith(13, { path: '' });
    expect(store.expanded()).toEqual([]);
    expect(labels(store.nodes())).toEqual([ 'other.md' ]);
  });

  describe('renamed', () => {
    it('keeps a renamed folder and its expanded sub-folders expanded, listing them again', async () => {
      localStorage.setItem(MEMORY, JSON.stringify([ 'docs', 'docs/api', 'notes' ]));
      store.init(12);
      await flush();
      folders[''] = listing('', [ folder('build', { ignored: true }), folder('notes'), entry('README.md') ]);
      folders['build'] = listing('build', [ folder('api', { ignored: true }), entry('guide.md', { ignored: true }) ], {
        ignored: true
      });
      folders['build/api'] = listing('build/api', [ entry('index.md', { ignored: true }) ], { ignored: true });
      listFolder.mockClear();

      store.renamed('docs', 'build');
      await store.load('');
      // As the tree asks for the expanded folders it shows.
      await store.load('build');
      await store.load('build/api');
      TestBed.tick();

      expect(store.expanded()).toEqual([ 'build', 'notes', 'build/api' ]);
      expect(JSON.parse(localStorage.getItem(MEMORY) ?? '[]')).toEqual([ 'build', 'notes', 'build/api' ]);
      // Listed again at the new path: git now ignores them (FB-31).
      expect(node('build/api/index.md')?.entry?.ignored).toBe(true);
      expect(store.entry('build/api')?.ignored).toBe(true);
      expect(listed()).toEqual([ '', 'build', 'build/api' ]);
    });

    it('drops a listing on its way for the old path', async () => {
      const pending = new Subject<FolderListing>();
      answers['docs'] = [ pending ];
      store.init(12);
      await flush();
      void store.load('docs');
      store.expand('docs');
      await flush();

      store.renamed('docs', 'guides');
      pending.next(listing('docs', [ entry('stale.md') ]));
      await flush();

      expect(store.expanded()).toEqual([ 'guides' ]);
      expect(store.entry('docs/stale.md')).toBeUndefined();
      expect(store.entry('guides/stale.md')).toBeUndefined();
    });

    it('leaves other paths alone', async () => {
      localStorage.setItem(MEMORY, JSON.stringify([ 'docs', 'notes' ]));
      store.init(12);
      await flush();

      store.renamed('doc', 'paper');

      expect(store.expanded()).toEqual([ 'docs', 'notes' ]);
      expect(store.entry('docs/guide.md')).toBeDefined();
    });
  });

  describe('known', () => {
    beforeEach(() => {
      folders['notes'] = listing('notes', [ entry('a.md'), entry('b.md') ], { more: 3 });
    });

    it('shows and finds an entry made beyond a long folder\'s listed entries (FB-18)', async () => {
      store.init(12);
      await flush();

      store.known('notes/zzz.md', entry('zzz.md'));
      await store.load('notes');

      expect(labels(node('notes')?.children)).toEqual([ 'a.md', 'b.md', 'zzz.md', '2 more items not shown' ]);
      expect(await store.resolve('notes/zzz.md')).toEqual(entry('zzz.md'));
      expect(store.entry('notes/zzz.md')).toEqual(entry('zzz.md'));
      expect((await store.entries('notes'))?.map(item => item.name)).toEqual([ 'a.md', 'b.md', 'zzz.md' ]);
    });

    it('adds nothing to a listing that has the entry or lists everything', async () => {
      store.init(12);
      await flush();

      store.known('notes/b.md', entry('b.md'));
      store.known('docs/new.md', entry('new.md'));
      await store.load('notes');
      await store.load('docs');

      expect(labels(node('notes')?.children)).toEqual([ 'a.md', 'b.md', '3 more items not shown' ]);
      expect(store.entry('docs/new.md')).toBeUndefined();
    });

    it('moves known entries with a renamed folder and forgets the renamed one', async () => {
      folders[''] = listing('', [ folder('docs'), folder('notes'), entry('README.md') ], { more: 1 });
      store.init(12);
      await flush();
      store.known('notes/zzz.md', entry('zzz.md'));
      store.known('old', folder('old'));

      store.renamed('notes', 'papers');
      store.renamed('old', 'new');
      folders['papers'] = listing('papers', [ entry('a.md'), entry('b.md') ], { more: 3 });
      await store.load('papers');
      await store.load('');

      expect(store.entry('papers/zzz.md')).toEqual(entry('zzz.md'));
      expect(store.entry('old')).toBeUndefined();
    });
  });

  describe('deleting', () => {
    it('shows Deleting… and blocks the row', async () => {
      localStorage.setItem(MEMORY, JSON.stringify([ 'docs' ]));
      store.init(12);
      await flush();

      store.markDeleting('docs', true);
      store.markDeleting('README.md', true);

      expect(node('docs')).toMatchObject({ deleting: true, selectable: false, expandable: false, children: undefined });
      expect(node('docs')?.accessibleName).toBe('docs, folder, Deleting…');
      expect(node('README.md')).toMatchObject({ deleting: true, selectable: false });
      expect(node('docs/guide.md')).toBeUndefined();

      store.markDeleting('docs', false);

      expect(node('docs')).toMatchObject({ selectable: false, expandable: true });
      expect(node('docs')?.deleting).toBeFalsy();
      expect(node('docs/guide.md')).toBeDefined();
    });

    it('keeps the deleting mark across a reload', async () => {
      const pending = new Subject<FolderListing>();
      store.init(12);
      await flush();
      answers['docs'] = [ pending ];
      void store.load('docs');
      store.expand('docs');

      store.markDeleting('docs/guide.md', true);
      pending.next(listing('docs', [ folder('api'), entry('guide.md') ]));
      pending.complete();
      await flush();
      await store.load('docs');

      expect(node('docs/guide.md')?.deleting).toBe(true);
    });

    it('forgets a deleted folder\'s listings, expanded folders and known entries', async () => {
      folders['notes'] = listing('notes', [ entry('a.md') ], { more: 3 });
      localStorage.setItem(MEMORY, JSON.stringify([ 'docs', 'docs/api', 'notes' ]));
      store.init(12);
      await flush();
      store.known('notes/zzz.md', entry('zzz.md'));
      store.markDeleting('docs', true);

      store.deleted('docs');
      store.deleted('notes/zzz.md');

      expect(store.expanded()).toEqual([ 'notes' ]);
      expect(store.entry('docs/api/index.md')).toBeUndefined();
      expect(store.entry('notes/zzz.md')).toBeUndefined();
      expect(node('docs')?.deleting).toBeFalsy();
    });
  });
});
