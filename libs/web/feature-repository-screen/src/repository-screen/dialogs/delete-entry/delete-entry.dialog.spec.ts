import { TestBed } from '@angular/core/testing';
import type { Entry, EntrySummary } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, Subject, switchMap, throwError, timer } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { entry, folder } from '../../../testing/listings';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type DeleteEntryData, DeleteEntryDialog } from './delete-entry.dialog';

const K = 'web-feature-repository-screen.DeleteEntryDialog';

describe('DeleteEntryDialog', () => {
  let ref: DialogRef<boolean>;
  let summary: () => Observable<EntrySummary>;
  let summaries: number;
  let deleteAnswer: () => Observable<void>;
  let deleted: string[];
  let marks: boolean[];

  const heading = () => overlay().querySelector('h2')?.textContent?.trim();
  const messages = () => [ ...overlay().querySelectorAll('p') ].map(item => item.textContent?.trim());
  const banner = () => overlay().querySelector('ui-inline-banner')?.textContent?.trim();

  async function open(path: string, shown: Entry): Promise<void> {
    ref = TestBed.inject(DialogService).open<DeleteEntryDialog, DeleteEntryData, boolean>(DeleteEntryDialog, {
      data: { repositoryId: 12, path, entry: shown, marked: deleting => marks.push(deleting) }
    });
    await settleDialog();
  }

  beforeEach(() => {
    summary = () => of({ files: 1, nonMarkdown: 0, uncommitted: 0 });
    summaries = 0;
    deleteAnswer = () => of(undefined);
    deleted = [];
    marks = [];
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${K}.heading`]: 'Delete {{ name }}?',
          [`${K}.folder`]: '{{ files }} files, {{ nonMarkdown }} non-Markdown',
          [`${K}.uncommittedFolder`]: '{{ uncommitted }} uncommitted'
        })
      ],
      providers: [
        {
          provide: FilesApi,
          useValue: {
            entrySummary: () => {
              summaries++;
              return summary();
            },
            deleteEntry: (_id: number, query: { path: string; }) => {
              deleted.push(query.path);
              return deleteAnswer();
            }
          }
        }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('warns about an uncommitted file', async () => {
    summary = () => of({ files: 1, nonMarkdown: 0, uncommitted: 1 });

    await open('docs/notes.md', entry('notes.md'));

    expect(heading()).toBe('Delete notes.md?');
    expect(messages()).toEqual([ `${K}.uncommittedFile` ]);
  });

  it('does not warn about a committed file', async () => {
    await open('docs/notes.md', entry('notes.md'));

    expect(heading()).toBe('Delete notes.md?');
    expect(messages()).toEqual([]);
  });

  it('counts uncommitted files in the confirmation', async () => {
    summary = () => of({ files: 3, nonMarkdown: 1, uncommitted: 3 });

    await open('docs', folder('docs'));

    expect(messages()).toEqual([ '3 files, 1 non-Markdown', '3 uncommitted' ]);
  });

  it('says nothing can be lost when every file of a folder is committed', async () => {
    summary = () => of({ files: 2, nonMarkdown: 0, uncommitted: 0 });

    await open('docs', folder('docs'));

    expect(messages()).toEqual([ '2 files, 0 non-Markdown' ]);
  });

  it('says only the link is deleted, without asking for a summary', async () => {
    summary = () => throwError(() => apiError(500, 'internal'));

    await open('latest', entry('latest', { kind: 'symlink', size: null }));

    expect(messages()).toEqual([ `${K}.symlink` ]);
    expect(dialogButton(`${K}.delete`)).toBeDefined();
    expect(summaries).toBe(0);
  });

  it('stops asking for the summary when it is closed', async () => {
    const pending = new Subject<EntrySummary>();
    summary = () => pending;
    await open('docs', folder('docs'));

    dialogButton(`${K}.cancel`)?.click();
    await settleDialog();

    expect(pending.observed).toBe(false);
  });

  it('closes as deleted when the entry is already gone', async () => {
    deleteAnswer = () => throwError(() => apiError(404, 'entry-not-found'));
    await open('docs/notes.md', entry('notes.md'));
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.delete`)?.click();

    expect(await closed).toBe(true);
    expect(marks).toEqual([ true ]);
  });

  it('closes as deleted when the summary finds the entry gone', async () => {
    // As an HTTP answer comes: after the dialog has opened.
    summary = () => timer(10).pipe(switchMap(() => throwError(() => apiError(404, 'entry-not-found'))));
    const opened = open('docs/notes.md', entry('notes.md'));
    const closed = firstValueFrom(ref.closed);
    await opened;

    expect(await closed).toBe(true);
  });

  it('marks the row, deletes and closes', async () => {
    await open('docs/notes.md', entry('notes.md'));
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.delete`)?.click();

    expect(await closed).toBe(true);
    expect(deleted).toEqual([ 'docs/notes.md' ]);
    expect(marks).toEqual([ true ]);
  });

  it('closes with false on Cancel, without deleting', async () => {
    await open('docs/notes.md', entry('notes.md'));
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.cancel`)?.click();

    expect(await closed).toBe(false);
    expect(deleted).toEqual([]);
    expect(marks).toEqual([]);
  });

  it('keeps open with the error and clears the mark when the delete fails', async () => {
    deleteAnswer = () => throwError(() => apiError(409, 'merge-in-progress'));
    await open('docs/notes.md', entry('notes.md'));

    dialogButton(`${K}.delete`)?.click();
    await settleDialog();

    expect(overlay().querySelector('rs-delete-entry')).not.toBeNull();
    expect(banner()).toContain('merge-in-progress');
    expect(marks).toEqual([ true, false ]);
  });

  it('offers Try again and no Delete when the summary fails', async () => {
    let attempts = 0;
    summary = () =>
      ++attempts === 1 ? throwError(() => apiError(500, 'internal')) : of({ files: 1, nonMarkdown: 0, uncommitted: 1 });
    await open('docs/notes.md', entry('notes.md'));

    expect(banner()).toContain('internal');
    expect(dialogButton(`${K}.delete`)).toBeUndefined();

    dialogButton(`${K}.retry`)?.click();
    await settleDialog();

    expect(messages()).toEqual([ `${K}.uncommittedFile` ]);
    expect(dialogButton(`${K}.delete`)).toBeDefined();
  });
});
