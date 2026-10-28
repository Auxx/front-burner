import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser, Entry, FolderListing } from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { of, throwError } from 'rxjs';

import { entry, folder, listing } from '../../../testing/listings';
import { translocoTesting } from '../../../testing/transloco-testing';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { FirstFileService } from './first-file.service';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

const LAST_FILE = 'fb.4.repo.12.lastFile';

describe('FirstFileService', () => {
  let folders: Record<string, FolderListing>;
  let first: FirstFileService;

  function withRoot(...entries: Entry[]): void {
    folders[''] = listing('', entries);
  }

  async function pick(): Promise<string | null> {
    TestBed.inject(FileTreeStoreService).init(12);
    return first.pick(12);
  }

  beforeEach(() => {
    localStorage.clear();
    folders = {
      '': listing('', [ folder('docs'), entry('README.md') ]),
      docs: listing('docs', [ entry('guide.md'), entry('logo.png') ])
    };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        FileTreeStoreService,
        FirstFileService,
        {
          provide: FilesApi,
          useValue: {
            listFolder: (_id: number, query: { path: string; }) =>
              folders[query.path] ? of(folders[query.path]) : throwError(() => ({ status: 404 }))
          }
        },
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } }
      ]
    });
    first = TestBed.inject(FirstFileService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('picks the root README', async () => {
    expect(await pick()).toBe('README.md');
  });

  it.each([ 'readme.markdown', 'ReadMe.MDX', 'README.md' ])('picks %s, whatever its case and Markdown extension', async name => {
    withRoot(entry('a.md'), entry('README.txt'), folder('readme.md'), entry(name));

    expect(await pick()).toBe(name);
  });

  it('picks nothing without a README', async () => {
    withRoot(entry('README.txt'), entry('notes.md'));

    expect(await pick()).toBeNull();
  });

  it('picks the last file remembered on this device', async () => {
    first.remember(12, 'docs/guide.md');
    await Promise.resolve();

    expect(localStorage.getItem(LAST_FILE)).toBe('docs/guide.md');
    expect(await pick()).toBe('docs/guide.md');
  });

  it.each([ 'docs/gone.md', 'docs/logo.png', 'docs' ])('falls back to the README when the last file %j cannot be opened', async last => {
    localStorage.setItem(LAST_FILE, last);

    expect(await pick()).toBe('README.md');
  });

  it('works without localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    first.remember(12, 'docs/guide.md');
    expect(await pick()).toBe('README.md');
  });
});
