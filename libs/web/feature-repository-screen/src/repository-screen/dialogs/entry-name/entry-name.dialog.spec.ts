import { TestBed } from '@angular/core/testing';
import type {
  CreateEntryRequest,
  EntryPath,
  IgnoreQuery,
  IgnoreResult,
  RenameEntryRequest
} from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, throwError } from 'rxjs';

import { apiError, dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { entry, folder } from '../../../testing/listings';
import { translocoTesting } from '../../../testing/transloco-testing';
import { IGNORE_CHECK_DELAY } from '../../utils/entry-name-field/entry-name-field';
import { EntryNameDialog, type NewEntryData, type RenameEntryData } from './entry-name.dialog';

const P = 'web-feature-repository-screen';
const K = `${P}.EntryNameDialog`;

describe('EntryNameDialog', () => {
  let ref: DialogRef<EntryPath>;
  let created: CreateEntryRequest[];
  let createAnswer: () => Observable<EntryPath>;
  let renamed: RenameEntryRequest[];
  let renameAnswer: () => Observable<EntryPath>;
  let ignoreQueries: IgnoreQuery[];
  let ignored: (query: IgnoreQuery) => boolean;

  const heading = () => overlay().querySelector('h2')?.textContent?.trim();
  const hint = () => overlay().querySelector('ui-field .hint')?.textContent?.trim();
  const error = () => overlay().querySelector('ui-field .error')?.textContent?.trim();
  const banners = () =>
    [ ...overlay().querySelectorAll('ui-inline-banner') ].map(banner => [
      banner.getAttribute('data-status'),
      banner.textContent?.trim()
    ]);
  const selection = () => [ nameInput().selectionStart, nameInput().selectionEnd ];
  const waitForIgnoreCheck = () => new Promise(resolve => setTimeout(resolve, IGNORE_CHECK_DELAY + 20));

  async function open(data: NewEntryData | RenameEntryData): Promise<void> {
    ref = TestBed.inject(DialogService).open<EntryNameDialog, NewEntryData | RenameEntryData, EntryPath>(
      EntryNameDialog,
      { data }
    );
    await settleDialog();
  }

  function create(data: Partial<NewEntryData> = {}): Promise<void> {
    return open({
      mode: 'create',
      repositoryId: 12,
      folder: 'docs',
      kind: 'file',
      folderIgnored: false,
      siblings: [ 'readme.md' ],
      ...data
    });
  }

  function rename(data: Partial<RenameEntryData> = {}): Promise<void> {
    return open({
      mode: 'rename',
      repositoryId: 12,
      path: 'docs/readme.md',
      entry: entry('readme.md'),
      siblings: [ 'readme.md', 'guide.md' ],
      ...data
    });
  }

  async function submit(mode: 'create' | 'rename'): Promise<void> {
    dialogButton(`${K}.submit.${mode}`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    created = [];
    createAnswer = () => of({ path: 'docs/notes.md' });
    renamed = [];
    renameAnswer = () => of({ path: 'docs/README.md' });
    ignoreQueries = [];
    ignored = () => false;
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${K}.finalName.create`]: 'Will be created as {{ name }}',
          [`${K}.finalName.rename`]: 'Will be renamed to {{ name }}',
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
            renameEntry: (_id: number, request: RenameEntryRequest) => {
              renamed.push(request);
              return renameAnswer();
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

  describe('New file and New folder', () => {
    it('starts with untitled selected', async () => {
      await create();

      expect(heading()).toBe(`${K}.heading.new-file`);
      expect(nameInput().value).toBe('untitled.md');
      expect(document.activeElement).toBe(nameInput());
      expect(selection()).toEqual([ 0, 'untitled'.length ]);
      expect(hint()).toBeUndefined();
    });

    it('shows the final name', async () => {
      await create();

      type(nameInput(), 'notes.txt');
      await settleDialog();

      expect(hint()).toBe('Will be created as notes.txt.md');

      type(nameInput(), 'notes.md');
      await settleDialog();

      expect(hint()).toBeUndefined();
    });

    it('shows each problem\'s text', async () => {
      await create();
      const cases: [ string, string ][] = [
        [ '', 'Enter a name.' ],
        [ '..', `${P}.nameErrors.dot` ],
        [ 'a/b', `${P}.nameErrors.separator` ],
        // An input drops line breaks; a tab is a control character too.
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
      await submit('create');

      expect(created).toEqual([]);
    });

    it('flags a clash with a sibling ignoring case', async () => {
      await create();

      type(nameInput(), 'README');
      await settleDialog();

      expect(error()).toBe(`${P}.nameErrors.name-taken`);
    });

    it('creates the entry with the name as typed and closes with its path', async () => {
      await create();
      const result = firstValueFrom(ref.closed);

      type(nameInput(), 'notes');
      await submit('create');

      expect(created).toEqual([ { folder: 'docs', name: 'notes', kind: 'file' } ]);
      expect(await result).toEqual({ path: 'docs/notes.md' });
    });

    it('warns when the parent folder is ignored', async () => {
      await create({ folderIgnored: true });

      expect(banners()).toEqual([ [ 'warning', `${K}.ignored.file` ] ]);
    });

    it('warns when the server says the new name is ignored', async () => {
      ignored = query => query.path === 'docs/debug.log.md';
      await create();
      await waitForIgnoreCheck();
      expect(banners()).toEqual([]);

      type(nameInput(), 'debug');
      type(nameInput(), 'debug.log');
      await waitForIgnoreCheck();

      expect(ignoreQueries).toEqual([
        { path: 'docs/untitled.md', kind: 'file' },
        { path: 'docs/debug.log.md', kind: 'file' }
      ]);
      expect(banners()).toEqual([ [ 'warning', `${K}.ignored.file` ] ]);
    });

    it('notes that empty folders aren\'t saved', async () => {
      await create({ kind: 'folder', folderIgnored: true });

      expect(heading()).toBe(`${K}.heading.new-folder`);
      expect(nameInput().value).toBe('');
      // No error until the user types or tries to create.
      expect(error()).toBeUndefined();
      expect(banners()).toEqual([ [ 'warning', `${K}.ignored.folder` ], [ 'info', `${K}.emptyFolder` ] ]);
      expect(hint()).toBeUndefined();
    });

    it('keeps the dialog open with the server\'s field error', async () => {
      createAnswer = () =>
        throwError(() => apiError(409, 'validation-failed', [ { path: 'name', code: 'name-taken' } ]));
      await create();
      let closed = false;
      ref.closed.subscribe(() => (closed = true));

      type(nameInput(), 'notes');
      await submit('create');

      expect(closed).toBe(false);
      expect(nameInput().value).toBe('notes');
      expect(error()).toBe(`${P}.nameErrors.name-taken`);
      expect(dialogButton(`${K}.submit.create`)?.getAttribute('aria-disabled')).toBeNull();

      type(nameInput(), 'notes2');
      await settleDialog();

      expect(error()).toBeUndefined();
    });

    it('shows any other failure above the field', async () => {
      createAnswer = () => throwError(() => apiError(409, 'merge-in-progress'));
      await create();

      await submit('create');

      expect(banners()).toEqual([ [ 'danger', expect.stringContaining('abcdef01') ] ]);
      expect(nameInput().value).toBe('untitled.md');
    });
  });

  describe('Rename', () => {
    it('starts with the name, its extension not selected', async () => {
      await rename();

      expect(heading()).toBe(`${K}.heading.rename`);
      expect(nameInput().value).toBe('readme.md');
      expect(selection()).toEqual([ 0, 'readme'.length ]);
    });

    it('selects a folder\'s whole name', async () => {
      await rename({ path: 'docs', entry: folder('docs.v2') });

      expect(selection()).toEqual([ 0, 'docs.v2'.length ]);
    });

    it('shows the final name', async () => {
      await rename();

      type(nameInput(), 'guide.txt');
      await settleDialog();

      expect(hint()).toBe('Will be renamed to guide.txt.md');
    });

    it('flags a clash with a sibling ignoring case', async () => {
      await rename();

      type(nameInput(), 'Guide.md');
      await settleDialog();

      expect(error()).toBe(`${P}.nameErrors.name-taken`);
    });

    it('allows a case-only rename of the entry itself', async () => {
      await rename();
      const result = firstValueFrom(ref.closed);

      type(nameInput(), 'README.md');
      await settleDialog();
      expect(error()).toBeUndefined();
      await submit('rename');

      expect(renamed).toEqual([ { path: 'docs/readme.md', name: 'README.md' } ]);
      expect(await result).toEqual({ path: 'docs/README.md' });
    });

    it('closes without a request when the name is unchanged', async () => {
      await rename();
      const result = firstValueFrom(ref.closed);

      await submit('rename');

      expect(renamed).toEqual([]);
      expect(await result).toBeUndefined();
    });

    it('counts a name on disk in another Unicode form as unchanged', async () => {
      // A folder named on macOS, whose é is `e` and a combining accent.
      await rename({ path: 'café', entry: folder('café'), siblings: [ 'café' ] });
      const result = firstValueFrom(ref.closed);
      await waitForIgnoreCheck();

      expect(hint()).toBeUndefined();
      expect(ignoreQueries).toEqual([]);
      await submit('rename');

      expect(renamed).toEqual([]);
      expect(await result).toBeUndefined();
    });

    it('warns when the server says the new name is ignored', async () => {
      ignored = query => query.path === 'docs/build' && query.kind === 'folder';
      await rename({ path: 'docs/notes', entry: folder('notes') });

      type(nameInput(), 'build');
      await waitForIgnoreCheck();

      expect(banners()).toEqual([ [ 'warning', `${K}.ignored.folder` ] ]);
    });

    it('asks the confirmation with the dialog open, and keeps it as it was when cancelled', async () => {
      const answers = [ false, true ];
      await rename({
        path: 'docs',
        entry: folder('docs'),
        siblings: [ 'docs' ],
        confirm: () => Promise.resolve(answers.shift() ?? true)
      });
      renameAnswer = () => of({ path: 'guides' });
      const result = firstValueFrom(ref.closed);

      type(nameInput(), 'guides');
      await submit('rename');

      expect(renamed).toEqual([]);
      expect(nameInput().value).toBe('guides');
      expect(overlay().querySelector('rs-entry-name')).not.toBeNull();

      await submit('rename');

      expect(renamed).toEqual([ { path: 'docs', name: 'guides' } ]);
      expect(await result).toEqual({ path: 'guides' });
    });

    it('keeps the dialog open with the server\'s field error', async () => {
      renameAnswer = () =>
        throwError(() => apiError(409, 'validation-failed', [ { path: 'name', code: 'name-taken' } ]));
      await rename();

      type(nameInput(), 'notes.md');
      await submit('rename');

      expect(nameInput().value).toBe('notes.md');
      expect(error()).toBe(`${P}.nameErrors.name-taken`);
      expect(overlay().querySelector('rs-entry-name')).not.toBeNull();
    });

    it('shows an unknown field code with the general text', async () => {
      renameAnswer = () =>
        throwError(() => apiError(400, 'validation-failed', [ { path: 'name', code: 'newer-rule' } ]));
      await rename();

      type(nameInput(), 'notes.md');
      await submit('rename');

      expect(error()).toBe(`${P}.nameErrors.invalid`);
    });
  });
});
