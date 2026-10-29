import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FileState } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import type { SaveResult } from '@front-burner/web-core';
import { Observable, of, Subject, throwError } from 'rxjs';

import { openFile } from '../../../testing/open-files';
import { translocoTesting } from '../../../testing/transloco-testing';
import { EntryCommandsService } from '../entry-commands/entry-commands.service';
import type { OpenFile } from '../open-files/open-files.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { DiskChangesService } from './disk-changes.service';

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);

const K = 'web-feature-repository-screen.DiskChangesService';

function notFound(): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 404,
    error: { code: 'entry-not-found', params: {}, requestId: '', message: 'entry-not-found' }
  });
}

/** Lets promise chains and synchronous answers finish. */
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve));
  }
};

describe('DiskChangesService', () => {
  let file: OpenFile;
  let sends: { content: string; resolve(result: SaveResult): void; reject(error: unknown): void; }[];
  let fileState: ReturnType<typeof vi.fn<(id: number, query: { path: string; }) => Observable<FileState>>>;
  let own: Set<string>;
  let missing: Subject<string>;
  let openFiles: {
    get: (path: string) => OpenFile | undefined;
    isOwnSave: (file: OpenFile, hash: string) => boolean;
    missing: Subject<string>;
    markGone: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    changedOnDisk: ReturnType<typeof vi.fn>;
  };
  let toast: { show: ReturnType<typeof vi.fn>; };
  let service: DiskChangesService;

  beforeEach(() => {
    sends = [];
    file = openFile('docs/guide.md', { hash: OLD }, content =>
      new Promise<SaveResult>((resolve, reject) => {
        sends.push({ content, resolve, reject });
      }).then(result => {
        file.hash.set(result.hash);
        return result;
      }));
    fileState = vi.fn(() => of({ hash: NEW, size: 10 }));
    own = new Set();
    missing = new Subject();
    openFiles = {
      get: path => (path === file.path() ? file : undefined),
      isOwnSave: (open, hash) => hash === open.hash(),
      missing,
      markGone: vi.fn(),
      reload: vi.fn(async () => true),
      changedOnDisk: vi.fn()
    };
    toast = { show: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        DiskChangesService,
        { provide: OpenFilesService, useValue: openFiles },
        { provide: EntryCommandsService, useValue: { isOwnChange: (path: string) => own.has(path) } },
        { provide: RepositorySessionService, useValue: { repository: signal({ id: 12 }) } },
        { provide: FilesApi, useValue: { fileState } },
        { provide: ToastService, useValue: toast }
      ]
    });
    service = TestBed.inject(DiskChangesService);
  });

  afterEach(() => vi.useRealTimers());

  /** Edits the file and lets its save be sent. */
  async function sendSave(content: string): Promise<void> {
    vi.useFakeTimers();
    file.saver.edit(() => content);
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
  }

  it('ignores its own save', async () => {
    await sendSave('mine');
    sends[0].resolve({ hash: NEW });
    await flush();

    expect(await service.check('docs/guide.md', NEW)).toBeNull();
    expect(fileState).not.toHaveBeenCalled();
  });

  it('ignores its own save when the event comes first', async () => {
    await sendSave('mine');
    service.notice('docs/guide.md', NEW);
    await flush();
    sends[0].resolve({ hash: NEW });
    await flush();

    expect(openFiles.reload).not.toHaveBeenCalled();
    expect(openFiles.changedOnDisk).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('asks for the state when a save in flight answers with another hash than the event', async () => {
    await sendSave('mine');
    const checked = service.check('docs/guide.md', NEW);
    sends[0].resolve({ hash: 'c'.repeat(64) });

    expect(await checked).toEqual({ kind: 'changed', hash: NEW });
    expect(fileState).toHaveBeenCalledWith(12, { path: 'docs/guide.md' });
  });

  it('reports a changed hash from the event', async () => {
    expect(await service.check('docs/guide.md', NEW)).toEqual({ kind: 'changed', hash: NEW });
    expect(fileState).not.toHaveBeenCalled();
  });

  it('checks the hash when no event names it', async () => {
    expect(await service.check('docs/guide.md')).toEqual({ kind: 'changed', hash: NEW });
    fileState.mockReturnValue(of({ hash: OLD, size: 10 }));
    expect(await service.check('docs/guide.md')).toBeNull();
  });

  it('reports a file that is gone', async () => {
    fileState.mockReturnValue(throwError(() => notFound()));

    expect(await service.check('docs/guide.md')).toEqual({ kind: 'gone' });
  });

  it('reports nothing for this tab\'s own rename or delete, or a file that is not open', async () => {
    fileState.mockReturnValue(throwError(() => notFound()));
    own.add('docs/guide.md');

    expect(await service.check('docs/guide.md')).toBeNull();
    expect(await service.check('other.md', NEW)).toBeNull();
  });

  it('reports nothing when the state cannot be found out', async () => {
    fileState.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    expect(await service.check('docs/guide.md')).toBeNull();
  });

  it('reports a file gone elsewhere that is back again as changed, whatever its hash', async () => {
    file.gone.set(true);
    fileState.mockReturnValue(of({ hash: OLD, size: 10 }));

    expect(await service.check('docs/guide.md')).toEqual({ kind: 'changed', hash: OLD });
  });

  it('reports gone when a save is refused as missing', async () => {
    const changes: unknown[] = [];
    service.changes.subscribe(change => changes.push(change));

    missing.next('docs/guide.md');
    await flush();

    expect(changes).toEqual([ { path: 'docs/guide.md', change: { kind: 'gone' } } ]);
    expect(openFiles.markGone).toHaveBeenCalledWith('docs/guide.md');
  });

  it('does not take a save refused during this tab\'s own rename for a file gone', async () => {
    own.add('docs/guide.md');
    missing.next('docs/guide.md');
    await flush();

    expect(openFiles.markGone).not.toHaveBeenCalled();
  });

  it('reloads a file without unsaved edits and says so', async () => {
    service.notice('docs/guide.md', NEW);
    await flush();

    expect(openFiles.reload).toHaveBeenCalledWith('docs/guide.md', { discard: false });
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: `${K}.updated`, status: 'info' }));
    expect(openFiles.changedOnDisk).not.toHaveBeenCalled();
  });

  it('asks about a file with unsaved edits, and holds its save meanwhile', async () => {
    vi.useFakeTimers();
    file.saver.edit(() => 'typed');
    service.notice('docs/guide.md', NEW);
    await vi.advanceTimersByTimeAsync(0);

    expect(openFiles.reload).not.toHaveBeenCalled();
    expect(openFiles.changedOnDisk).toHaveBeenCalledWith('docs/guide.md', NEW);
  });

  it('asks when the user typed while the change was checked', async () => {
    const answer = new Subject<FileState>();
    fileState.mockReturnValue(answer);
    service.notice('docs/guide.md');
    await flush();
    vi.useFakeTimers();
    file.saver.edit(() => 'typed meanwhile');
    await vi.advanceTimersByTimeAsync(5000);
    // Held while the change is checked.
    expect(sends).toHaveLength(0);

    answer.next({ hash: NEW, size: 10 });
    answer.complete();
    await vi.advanceTimersByTimeAsync(0);

    expect(openFiles.reload).not.toHaveBeenCalled();
    expect(openFiles.changedOnDisk).toHaveBeenCalledWith('docs/guide.md', NEW);
  });

  it('asks when the user typed while the file was reloaded', async () => {
    openFiles.reload.mockResolvedValue(false);
    service.notice('docs/guide.md', NEW);
    await flush();

    expect(toast.show).not.toHaveBeenCalled();
    expect(openFiles.changedOnDisk).toHaveBeenCalledWith('docs/guide.md', NEW);
  });

  it('finds the changes one at a time', async () => {
    const first = new Subject<FileState>();
    fileState.mockReturnValueOnce(first);
    service.notice('docs/guide.md');
    await flush();
    service.notice('docs/guide.md');
    await flush();
    expect(fileState).toHaveBeenCalledTimes(1);

    first.next({ hash: OLD, size: 10 });
    first.complete();
    await flush();

    expect(fileState).toHaveBeenCalledTimes(2);
  });

  it('ignores the late event of an earlier save of its own', async () => {
    const isOwnSave = vi.fn((_file: OpenFile, hash: string) => hash === OLD);
    openFiles.isOwnSave = isOwnSave;
    file.hash.set(NEW);

    expect(await service.check('docs/guide.md', OLD)).toBeNull();
    expect(isOwnSave).toHaveBeenCalledWith(file, OLD);
  });

  it('drops a notice like one that waits to start', async () => {
    const first = new Subject<FileState>();
    fileState.mockReturnValueOnce(first);
    service.notice('docs/guide.md');
    await flush();
    service.notice('docs/guide.md');
    service.notice('docs/guide.md');

    first.next({ hash: OLD, size: 10 });
    first.complete();
    await flush();
    expect(fileState).toHaveBeenCalledTimes(2);

    service.notice('docs/guide.md');
    await flush();
    expect(fileState).toHaveBeenCalledTimes(3);
  });

  it('queues a notice again once one for a file that is not open has had its turn', async () => {
    service.notice('other.md');
    await flush();
    file.path.set('other.md');

    service.notice('other.md');
    await flush();

    expect(fileState).toHaveBeenCalledTimes(1);
  });
});
