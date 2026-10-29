import { TestBed } from '@angular/core/testing';
import type { EntryPath, IgnoreQuery, IgnoreResult, RenameEntryRequest } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, throwError } from 'rxjs';

import { apiError, dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { entry, folder } from '../../../testing/listings';
import { translocoTesting } from '../../../testing/transloco-testing';
import { IGNORE_CHECK_DELAY } from '../../utils/entry-name-field/entry-name-field';
import { type RenameEntryData, RenameEntryDialog } from './rename-entry.dialog';

const P = 'web-feature-repository-screen';
const K = `${P}.RenameEntryDialog`;

describe('RenameEntryDialog', () => {
  let ref: DialogRef<EntryPath>;
  let renamed: RenameEntryRequest[];
  let renameAnswer: () => Observable<EntryPath>;
  let ignored: (query: IgnoreQuery) => boolean;

  const hint = () => overlay().querySelector('ui-field .hint')?.textContent?.trim();
  const error = () => overlay().querySelector('ui-field .error')?.textContent?.trim();
  const banners = () =>
    [ ...overlay().querySelectorAll('ui-inline-banner') ].map(banner => [
      banner.getAttribute('data-status'),
      banner.textContent?.trim()
    ]);

  async function open(data: Partial<RenameEntryData> = {}): Promise<void> {
    ref = TestBed.inject(DialogService).open<RenameEntryDialog, RenameEntryData, EntryPath>(RenameEntryDialog, {
      data: {
        repositoryId: 12,
        path: 'docs/readme.md',
        entry: entry('readme.md'),
        siblings: [ 'readme.md', 'guide.md' ],
        ...data
      }
    });
    await settleDialog();
  }

  async function rename(): Promise<void> {
    dialogButton(`${K}.rename`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    renamed = [];
    renameAnswer = () => of({ path: 'docs/README.md' });
    ignored = () => false;
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ [`${K}.finalName`]: 'Will be renamed to {{ name }}' }) ],
      providers: [
        {
          provide: FilesApi,
          useValue: {
            renameEntry: (_id: number, request: RenameEntryRequest) => {
              renamed.push(request);
              return renameAnswer();
            },
            isIgnored: (_id: number, query: IgnoreQuery): Observable<IgnoreResult> => of({ ignored: ignored(query) })
          }
        }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('starts with the name, its extension not selected', async () => {
    await open();

    expect(nameInput().value).toBe('readme.md');
    expect([ nameInput().selectionStart, nameInput().selectionEnd ]).toEqual([ 0, 'readme'.length ]);
  });

  it('selects a folder\'s whole name', async () => {
    await open({ path: 'docs', entry: folder('docs.v2') });

    expect([ nameInput().selectionStart, nameInput().selectionEnd ]).toEqual([ 0, 'docs.v2'.length ]);
  });

  it('shows the final name', async () => {
    await open();

    type(nameInput(), 'guide.txt');
    await settleDialog();

    expect(hint()).toBe('Will be renamed to guide.txt.md');
  });

  it('flags a clash with a sibling ignoring case', async () => {
    await open();

    type(nameInput(), 'Guide.md');
    await settleDialog();

    expect(error()).toBe(`${P}.nameErrors.name-taken`);
  });

  it('allows a case-only rename of the entry itself', async () => {
    await open();
    const result = firstValueFrom(ref.closed);

    type(nameInput(), 'README.md');
    await settleDialog();
    expect(error()).toBeUndefined();
    await rename();

    expect(renamed).toEqual([ { path: 'docs/readme.md', name: 'README.md' } ]);
    expect(await result).toEqual({ path: 'docs/README.md' });
  });

  it('closes without a request when the name is unchanged', async () => {
    await open();
    const result = firstValueFrom(ref.closed);

    await rename();

    expect(renamed).toEqual([]);
    expect(await result).toBeUndefined();
  });

  it('warns when the server says the new name is ignored', async () => {
    ignored = query => query.path === 'docs/build' && query.kind === 'folder';
    await open({ path: 'docs/notes', entry: folder('notes') });

    type(nameInput(), 'build');
    await new Promise(resolve => setTimeout(resolve, IGNORE_CHECK_DELAY + 20));

    expect(banners()).toEqual([ [ 'warning', `${K}.ignored.folder` ] ]);
  });

  it('asks the confirmation with the dialog open, and keeps it as it was when cancelled', async () => {
    const answers = [ false, true ];
    await open({
      path: 'docs',
      entry: folder('docs'),
      siblings: [ 'docs' ],
      confirm: () => Promise.resolve(answers.shift() ?? true)
    });
    renameAnswer = () => of({ path: 'guides' });
    const result = firstValueFrom(ref.closed);

    type(nameInput(), 'guides');
    await rename();

    expect(renamed).toEqual([]);
    expect(nameInput().value).toBe('guides');
    expect(overlay().querySelector('rs-rename-entry')).not.toBeNull();

    await rename();

    expect(renamed).toEqual([ { path: 'docs', name: 'guides' } ]);
    expect(await result).toEqual({ path: 'guides' });
  });

  it('keeps the dialog open with the server\'s field error', async () => {
    renameAnswer = () => throwError(() => apiError(409, 'validation-failed', [ { path: 'name', code: 'name-taken' } ]));
    await open();

    type(nameInput(), 'notes.md');
    await rename();

    expect(nameInput().value).toBe('notes.md');
    expect(error()).toBe(`${P}.nameErrors.name-taken`);
    expect(overlay().querySelector('rs-rename-entry')).not.toBeNull();
  });

  it('shows an unknown field code with the general text', async () => {
    renameAnswer = () => throwError(() => apiError(400, 'validation-failed', [ { path: 'name', code: 'newer-rule' } ]));
    await open();

    type(nameInput(), 'notes.md');
    await rename();

    expect(error()).toBe(`${P}.nameErrors.invalid`);
  });
});
