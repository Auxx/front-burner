import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CurrentUser,
  FileContent,
  FileState,
  RepositorySummary,
  SaveFileRequest
} from '@front-burner/shared-contracts';
import { FilesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { BehaviorSubject, map, type Observable, of, Subject, throwError } from 'rxjs';

import { apiError } from '../../../testing/dialog-testing';
import { MemoryDraftStore, provideMemoryDrafts } from '../../../testing/drafts';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { LARGE_FILE_ON_NARROW, OpenFilesService } from './open-files.service';

const HASH = 'a'.repeat(64);

const ada = { id: 4 } as CurrentUser;

function content(path: string, overrides: Partial<FileContent> = {}): FileContent {
  return { path, content: `# ${path}`, lineEnding: 'lf', bom: false, hash: HASH, size: 100, ...overrides };
}

describe('OpenFilesService', () => {
  let narrowNow: BehaviorSubject<boolean>;
  let service: OpenFilesService;
  let repository: ReturnType<typeof signal<RepositorySummary | null>>;
  let reads: Record<string, () => Observable<FileContent>>;
  let saves: { id: number; request: SaveFileRequest; answer: Subject<FileState>; }[];
  let drafts: MemoryDraftStore;

  beforeEach(() => {
    drafts = new MemoryDraftStore();
    narrowNow = new BehaviorSubject(false);
    repository = signal<RepositorySummary | null>({ id: 12 } as RepositorySummary);
    reads = {};
    saves = [];
    TestBed.configureTestingModule({
      providers: [
        OpenFilesService,
        provideMemoryDrafts(drafts),
        { provide: CurrentUserService, useValue: { user: signal(ada), load: () => Promise.resolve(ada) } },
        { provide: RepositorySessionService, useValue: { repository } },
        {
          provide: FilesApi,
          useValue: {
            readFile: (_id: number, query: { path: string; }) => reads[query.path]?.() ?? of(content(query.path)),
            saveFile: (id: number, request: SaveFileRequest) => {
              const answer = new Subject<FileState>();
              saves.push({ id, request, answer });
              return answer;
            }
          }
        },
        {
          provide: BreakpointObserver,
          useValue: {
            observe: () => narrowNow.pipe(map(matches => ({ matches, breakpoints: {} }))),
            isMatched: () => narrowNow.value
          }
        }
      ]
    });
    service = TestBed.inject(OpenFilesService);
  });

  it('opens a file and makes it the current one', async () => {
    const file = await service.open('docs/guide.md');

    expect(file.path()).toBe('docs/guide.md');
    expect(file.file.content).toBe('# docs/guide.md');
    expect(file.hash()).toBe(HASH);
    expect(file.editorState).toBeNull();
    expect(file.highlight()).toBe(true);
    expect(service.current()).toBe(file);
    expect(service.get('docs/guide.md')).toBe(file);
  });

  it('keeps a file\'s entry when another file is opened and back', async () => {
    const guide = await service.open('docs/guide.md');
    guide.editorState = { kept: true };
    await service.open('README.md');
    reads['docs/guide.md'] = () => throwError(() => new Error('read again'));

    const again = await service.open('docs/guide.md');

    expect(again).toBe(guide);
    expect(again.editorState).toEqual({ kept: true });
  });

  it('keeps the files of each repository apart', async () => {
    const first = await service.open('README.md');
    repository.set({ id: 13 } as RepositorySummary);

    const second = await service.open('README.md');

    expect(second).not.toBe(first);
    expect(service.get('README.md')).toBe(second);
  });

  it('rejects with the API error when the file cannot be opened, and has no current file', async () => {
    await service.open('README.md');
    reads['big.md'] = () => throwError(() => apiError(422, 'file-too-large'));

    await expect(service.open('big.md')).rejects.toMatchObject({ code: 'file-too-large' });
    expect(service.current()).toBeNull();
    expect(service.get('big.md')).toBeUndefined();
  });

  it('makes only the latest file opened the current one', async () => {
    const slow = new Subject<FileContent>();
    reads['slow.md'] = () => slow;
    const opening = service.open('slow.md');
    await service.open('README.md');

    slow.next(content('slow.md'));
    slow.complete();
    await opening;

    expect(service.current()?.path()).toBe('README.md');
  });

  it('saves through the API with the file\'s line ending and byte order mark', async () => {
    vi.useFakeTimers();
    try {
      reads['crlf.md'] = () => of(content('crlf.md', { lineEnding: 'crlf', bom: true }));
      const file = await service.open('crlf.md');

      file.saver.edit(() => 'new text');
      await vi.advanceTimersByTimeAsync(1500);
      expect(saves).toHaveLength(1);
      expect(saves[0]).toMatchObject({
        id: 12,
        request: { path: 'crlf.md', content: 'new text', lineEnding: 'crlf', bom: true }
      });

      saves[0].answer.next({ hash: 'b'.repeat(64), size: 8 });
      saves[0].answer.complete();
      await vi.advanceTimersByTimeAsync(0);
      expect(file.hash()).toBe('b'.repeat(64));
      expect(file.saver.status()).toEqual({ kind: 'saved' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds no file while no repository is open', () => {
    repository.set(null);

    expect(service.get('README.md')).toBeUndefined();
  });

  it('tells whether any file has unsaved edits', async () => {
    const file = await service.open('README.md');
    expect(service.anyUnsaved()).toBe(false);

    file.saver.edit(() => 'changed');

    expect(service.anyUnsaved()).toBe(true);
  });

  describe('large files on narrow screens (ED-9a)', () => {
    it('opens a large file without highlighting on a narrow screen', async () => {
      narrowNow.next(true);
      reads['big.md'] = () => of(content('big.md', { size: LARGE_FILE_ON_NARROW + 1 }));

      const file = await service.open('big.md');

      expect(file.largeOnNarrow).toBe(true);
      expect(file.highlight()).toBe(false);
    });

    it('highlights a large file on a wide screen', async () => {
      reads['big.md'] = () => of(content('big.md', { size: 150_000 }));

      const file = await service.open('big.md');

      expect(file.largeOnNarrow).toBe(false);
      expect(file.highlight()).toBe(true);
    });

    it('highlights a file of the limit\'s size', async () => {
      narrowNow.next(true);
      reads['limit.md'] = () => of(content('limit.md', { size: LARGE_FILE_ON_NARROW }));

      expect((await service.open('limit.md')).highlight()).toBe(true);
    });

    it('turns highlighting off again when the large file is opened again', async () => {
      narrowNow.next(true);
      reads['big.md'] = () => of(content('big.md', { size: 150_000 }));
      const file = await service.open('big.md');
      file.highlight.set(true);
      await service.open('README.md');

      await service.open('big.md');

      expect(file.highlight()).toBe(false);
    });
  });

  describe('browser drafts (ED-7, ED-20)', () => {
    const DRAFT = { content: '# Offline edit', savedAt: '2026-10-29T10:05:00.000Z' };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Answers the save at `index`; with no answer, it fails as when offline. */
    async function answer(index: number, state?: FileState): Promise<void> {
      if (state) {
        saves[index].answer.next(state);
        saves[index].answer.complete();
      } else {
        saves[index].answer.error(new Error('offline'));
      }
      await vi.advanceTimersByTimeAsync(0);
    }

    it('writes a draft when a save is sent and deletes it when confirmed', async () => {
      const file = await service.open('README.md');

      file.saver.edit(() => '# Edited');
      expect(drafts.at('README.md')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1500);
      expect(drafts.at('README.md')?.content).toBe('# Edited');
      expect(Number.isNaN(Date.parse(drafts.at('README.md')?.savedAt ?? ''))).toBe(false);

      await answer(0, { hash: 'b'.repeat(64), size: 8 });
      expect(drafts.at('README.md')).toBeUndefined();
    });

    it('keeps the draft while newer content is unsaved', async () => {
      const file = await service.open('README.md');
      file.saver.edit(() => '# First');
      await vi.advanceTimersByTimeAsync(1500);
      file.saver.edit(() => '# First and more');

      // The older save is confirmed while the newer content waits.
      await answer(0, { hash: 'b'.repeat(64), size: 7 });
      expect(drafts.at('README.md')?.content).toBe('# First');

      await vi.advanceTimersByTimeAsync(1500);
      expect(drafts.at('README.md')?.content).toBe('# First and more');
      await answer(1, { hash: 'c'.repeat(64), size: 16 });
      expect(drafts.at('README.md')).toBeUndefined();
    });

    it('writes the waiting content when asked, such as when the page is hidden', async () => {
      const file = await service.open('README.md');
      file.saver.edit(() => '# Typed just now');

      service.writeDrafts();
      await vi.advanceTimersByTimeAsync(0);

      expect(drafts.at('README.md')?.content).toBe('# Typed just now');
      expect(saves).toHaveLength(0);
    });

    it('offers a draft found when the file is opened', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, DRAFT);

      const file = await service.open('README.md');

      expect(file.draft()).toEqual(DRAFT);
      expect(file.file.content).toBe('# README.md');
    });

    it('restores a draft and saves it at once', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, DRAFT);
      const file = await service.open('README.md');

      service.restoreDraft('README.md', () => DRAFT.content);
      await vi.advanceTimersByTimeAsync(0);

      expect(file.draft()).toBeNull();
      expect(saves.map(save => save.request.content)).toEqual([ DRAFT.content ]);
      await answer(0, { hash: 'b'.repeat(64), size: 14 });
      expect(drafts.at('README.md')).toBeUndefined();
    });

    it('keeps the draft when a restored save cannot be sent', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, DRAFT);
      const file = await service.open('README.md');

      service.restoreDraft('README.md', () => DRAFT.content);
      await vi.advanceTimersByTimeAsync(0);
      await answer(0);

      expect(file.saver.status()).toEqual({ kind: 'offline' });
      expect(drafts.at('README.md')?.content).toBe(DRAFT.content);
    });

    it('discards a draft', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, DRAFT);
      const file = await service.open('README.md');

      service.discardDraft('README.md');
      await vi.advanceTimersByTimeAsync(0);

      expect(file.draft()).toBeNull();
      expect(drafts.at('README.md')).toBeUndefined();
      expect(saves).toHaveLength(0);
    });

    it('deletes a draft that equals the file, without offering it', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'README.md' }, { ...DRAFT, content: '# README.md' });

      const file = await service.open('README.md');
      await vi.advanceTimersByTimeAsync(0);

      expect(file.draft()).toBeNull();
      expect(drafts.at('README.md')).toBeUndefined();
    });

    it('keeps a draft whose file is gone', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'gone.md' }, DRAFT);
      reads['gone.md'] = () => throwError(() => apiError(404, 'not-found'));

      await expect(service.open('gone.md')).rejects.toMatchObject({ code: 'not-found' });

      expect(drafts.at('gone.md')).toEqual(DRAFT);
    });

    it('keeps the draft when a save is refused', async () => {
      const file = await service.open('README.md');
      file.saver.edit(() => '# Edited');
      await vi.advanceTimersByTimeAsync(1500);

      saves[0].answer.error(apiError(409, 'file-gone'));
      await vi.advanceTimersByTimeAsync(0);

      expect(file.saver.status()).toMatchObject({ kind: 'refused' });
      expect(drafts.at('README.md')?.content).toBe('# Edited');
    });

    it('deletes the drafts at a deleted path, also of files not opened', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'docs/other.md' }, DRAFT);
      const file = await service.open('docs/guide.md');
      file.saver.edit(() => '# Edited');
      await vi.advanceTimersByTimeAsync(1500);

      service.close('docs', { dropPending: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(drafts.at('docs/guide.md')).toBeUndefined();
      expect(drafts.at('docs/other.md')).toBeUndefined();
    });

    it('moves the drafts of a renamed path', async () => {
      await drafts.put({ userId: 4, repositoryId: 12, path: 'docs/other.md' }, DRAFT);

      service.rekey('docs', 'guide');
      await vi.advanceTimersByTimeAsync(0);

      expect(drafts.at('docs/other.md')).toBeUndefined();
      expect(drafts.at('guide/other.md')).toEqual(DRAFT);
    });
  });
});
