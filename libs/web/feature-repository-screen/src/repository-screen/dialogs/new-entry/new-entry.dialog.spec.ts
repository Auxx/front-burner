import { TestBed } from '@angular/core/testing';
import type { CreateEntryRequest, EntryPath, IgnoreQuery, IgnoreResult } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, throwError } from 'rxjs';

import { apiError, dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { IGNORE_CHECK_DELAY } from '../../utils/entry-name-field/entry-name-field';
import { type NewEntryData, NewEntryDialog } from './new-entry.dialog';

const P = 'web-feature-repository-screen';
const K = `${P}.NewEntryDialog`;

describe('NewEntryDialog', () => {
  let ref: DialogRef<EntryPath>;
  let created: CreateEntryRequest[];
  let createAnswer: () => Observable<EntryPath>;
  let ignoreQueries: IgnoreQuery[];
  let ignored: (query: IgnoreQuery) => boolean;

  const hint = () => overlay().querySelector('ui-field .hint')?.textContent?.trim();
  const error = () => overlay().querySelector('ui-field .error')?.textContent?.trim();
  const banners = () =>
    [ ...overlay().querySelectorAll('ui-inline-banner') ].map(banner => [
      banner.getAttribute('data-status'),
      banner.textContent?.trim()
    ]);

  async function open(data: Partial<NewEntryData> = {}): Promise<void> {
    ref = TestBed.inject(DialogService).open<NewEntryDialog, NewEntryData, EntryPath>(NewEntryDialog, {
      data: { repositoryId: 12, folder: 'docs', kind: 'file', folderIgnored: false, siblings: [ 'readme.md' ], ...data }
    });
    await settleDialog();
  }

  async function create(): Promise<void> {
    dialogButton(`${K}.create`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    created = [];
    createAnswer = () => of({ path: 'docs/notes.md' });
    ignoreQueries = [];
    ignored = () => false;
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${K}.finalName`]: 'Will be created as {{ name }}',
          [`${P}.nameErrors.empty`]: 'Enter a name.'
        })
      ],
      providers: [
        {
          provide: FilesApi,
          useValue: {
            createEntry: (_id: number, request: CreateEntryRequest) => {
              created.push(request);
              return createAnswer();
            },
            isIgnored: (_id: number, query: IgnoreQuery): Observable<IgnoreResult> => {
              ignoreQueries.push(query);
              return of({ ignored: ignored(query) });
            }
          }
        }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('starts with untitled selected', async () => {
    await open();

    expect(overlay().querySelector('h2')?.textContent?.trim()).toBe(`${K}.heading.file`);
    expect(nameInput().value).toBe('untitled.md');
    expect(document.activeElement).toBe(nameInput());
    expect([ nameInput().selectionStart, nameInput().selectionEnd ]).toEqual([ 0, 'untitled'.length ]);
    expect(hint()).toBeUndefined();
  });

  it('shows the final name', async () => {
    await open();

    type(nameInput(), 'notes.txt');
    await settleDialog();

    expect(hint()).toBe('Will be created as notes.txt.md');

    type(nameInput(), 'notes.md');
    await settleDialog();

    expect(hint()).toBeUndefined();
  });

  it('shows each problem\'s text', async () => {
    await open();
    const cases: [ string, string ][] = [
      [ '', 'Enter a name.' ],
      [ '..', `${P}.nameErrors.dot` ],
      [ 'a/b', `${P}.nameErrors.separator` ],
      [ 'a\tb', `${P}.nameErrors.control` ],
      [ 'notes ', `${P}.nameErrors.edge-space` ],
      [ '.git', `${P}.nameErrors.git` ],
      [ 'a'.repeat(300), `${P}.nameErrors.too-long` ]
    ];

    for (const [ value, text ] of cases) {
      type(nameInput(), value);
      await settleDialog();
      expect(error()).toBe(text);
    }
    await create();

    expect(created).toEqual([]);
  });

  it('flags a clash with a sibling ignoring case', async () => {
    await open();

    type(nameInput(), 'README');
    await settleDialog();

    expect(error()).toBe(`${P}.nameErrors.name-taken`);
  });

  it('creates the entry with the name as typed and closes with its path', async () => {
    await open();
    const result = firstValueFrom(ref.closed);

    type(nameInput(), 'notes');
    await create();

    expect(created).toEqual([ { folder: 'docs', name: 'notes', kind: 'file' } ]);
    expect(await result).toEqual({ path: 'docs/notes.md' });
  });

  it('warns when the parent folder is ignored', async () => {
    await open({ folderIgnored: true });

    expect(banners()).toEqual([ [ 'warning', `${K}.ignored.file` ] ]);
  });

  it('warns when the server says the new name is ignored', async () => {
    ignored = query => query.path === 'docs/debug.log.md';
    await open();
    await new Promise(resolve => setTimeout(resolve, IGNORE_CHECK_DELAY + 20));
    expect(banners()).toEqual([]);

    type(nameInput(), 'debug');
    type(nameInput(), 'debug.log');
    await new Promise(resolve => setTimeout(resolve, IGNORE_CHECK_DELAY + 20));

    expect(ignoreQueries).toEqual([
      { path: 'docs/untitled.md', kind: 'file' },
      { path: 'docs/debug.log.md', kind: 'file' }
    ]);
    expect(banners()).toEqual([ [ 'warning', `${K}.ignored.file` ] ]);
  });

  it('notes that empty folders aren\'t saved', async () => {
    await open({ kind: 'folder', folderIgnored: true });

    expect(overlay().querySelector('h2')?.textContent?.trim()).toBe(`${K}.heading.folder`);
    expect(nameInput().value).toBe('');
    // No error until the user types or tries to create.
    expect(error()).toBeUndefined();
    expect(banners()).toEqual([ [ 'warning', `${K}.ignored.folder` ], [ 'info', `${K}.emptyFolder` ] ]);
    expect(hint()).toBeUndefined();
  });

  it('keeps the dialog open with the server\'s field error', async () => {
    createAnswer = () => throwError(() => apiError(409, 'validation-failed', [ { path: 'name', code: 'name-taken' } ]));
    await open();
    let closed = false;
    ref.closed.subscribe(() => (closed = true));

    type(nameInput(), 'notes');
    await create();

    expect(closed).toBe(false);
    expect(nameInput().value).toBe('notes');
    expect(error()).toBe(`${P}.nameErrors.name-taken`);
    expect(dialogButton(`${K}.create`)?.getAttribute('aria-disabled')).toBeNull();

    type(nameInput(), 'notes2');
    await settleDialog();

    expect(error()).toBeUndefined();
  });

  it('shows any other failure above the field', async () => {
    createAnswer = () => throwError(() => apiError(409, 'merge-in-progress'));
    await open();

    await create();

    expect(banners()).toEqual([ [ 'danger', expect.stringContaining('abcdef01') ] ]);
    expect(nameInput().value).toBe('untitled.md');
  });
});
