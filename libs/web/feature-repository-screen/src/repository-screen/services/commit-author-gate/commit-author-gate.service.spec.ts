import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PushEvent, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';
import { CommitAuthorGate } from './commit-author-gate.service';

const QUESTION = 'web-repository-dialogs.ConfirmCommitAuthorDialog';
const EDITOR = 'web-repository-dialogs.CommitAuthorEditorComponent';

const ada = { name: 'Ada', email: 'ada@example.com' };
const unconfirmed: RepositoryCommitAuthor = { author: ada, source: 'default', confirmed: false };
const confirmed: RepositoryCommitAuthor = { ...unconfirmed, confirmed: true };
const work: RepositoryCommitAuthor = {
  author: { name: 'Ada L', email: 'a@work' },
  source: 'override',
  confirmed: true
};

describe('CommitAuthorGate', () => {
  let gate: CommitAuthorGate;
  let followed: ReturnType<typeof signal<number | null>>;
  let events: Subject<PushEvent>;
  let reconnected: Subject<void>;
  let api: Record<
    | 'repositoryCommitAuthor'
    | 'commitAuthor'
    | 'setCommitAuthor'
    | 'setRepositoryCommitAuthor'
    | 'removeRepositoryCommitAuthor'
    | 'confirmCommitAuthor',
    ReturnType<typeof vi.fn>
  >;

  const question = () => document.querySelector('dlg-confirm-commit-author');
  const commitAs = () => dialogButton(`${QUESTION}.commitAs`);

  function start(...answers: RepositoryCommitAuthor[]): void {
    answers.forEach(answer => api['repositoryCommitAuthor'].mockReturnValueOnce(of(answer)));
    gate = TestBed.inject(CommitAuthorGate);
    TestBed.tick();
  }

  beforeEach(() => {
    followed = signal<number | null>(12);
    events = new Subject();
    reconnected = new Subject();
    api = {
      repositoryCommitAuthor: vi.fn(() => of(confirmed)),
      commitAuthor: vi.fn(() => of({ author: ada, confirmed: false })),
      setCommitAuthor: vi.fn(() => of({ author: ada, confirmed: true })),
      setRepositoryCommitAuthor: vi.fn(() => of(work)),
      removeRepositoryCommitAuthor: vi.fn(() => of(confirmed)),
      confirmCommitAuthor: vi.fn(() => of(undefined))
    };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        CommitAuthorGate,
        { provide: PreferencesApi, useValue: api },
        { provide: GitStatusStore, useValue: { followed } },
        {
          provide: RepositorySessionService,
          useValue: { state: signal('ready'), repository: signal({ id: 12 }) }
        },
        { provide: PushChannelService, useValue: { events, reconnected } }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('reads the author that applies', async () => {
    start(work);
    await settleDialog();

    expect(api['repositoryCommitAuthor']).toHaveBeenCalledWith(12);
    expect(gate.author()).toEqual(work);
  });

  it('does not ask once the author is confirmed', async () => {
    start(confirmed);

    expect(await gate.ready()).toBe(true);
    expect(question()).toBeNull();
  });

  it('asks a user who has not confirmed, and goes on once they have', async () => {
    start(unconfirmed, unconfirmed, confirmed);

    const ready = gate.ready();
    await vi.waitFor(() => expect(commitAs()).toBeDefined());
    commitAs()?.click();

    expect(await ready).toBe(true);
    expect(api['confirmCommitAuthor']).toHaveBeenCalledTimes(1);
    expect(gate.author()?.confirmed).toBe(true);
  });

  it('does not go on when the question is cancelled', async () => {
    start(unconfirmed, unconfirmed);

    const ready = gate.ready();
    await settleDialog();
    dialogButton(`${QUESTION}.cancel`)?.click();

    expect(await ready).toBe(false);
  });

  it('does not ask when another tab has confirmed since the author was read', async () => {
    start(unconfirmed, confirmed);

    expect(await gate.ready()).toBe(true);
    expect(question()).toBeNull();
  });

  it('asks once when the API refuses, and goes on after one answer', async () => {
    start(confirmed, unconfirmed, confirmed);

    const again = gate.recheck();
    await settleDialog();
    expect(overlay().querySelectorAll('dlg-confirm-commit-author').length).toBe(1);
    commitAs()?.click();

    expect(await again).toBe(true);
  });

  it('does not ask when the API refused but the read finds the author confirmed by now', async () => {
    start(confirmed, confirmed);

    expect(await gate.recheck()).toBe(true);
    expect(question()).toBeNull();
  });

  it('does not commit when saving the author fails', async () => {
    start(unconfirmed, unconfirmed);
    api['setCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    let answer: boolean | undefined;

    void gate.ready().then(ready => (answer = ready));
    await settleDialog();
    dialogButton(`${QUESTION}.change`)?.click();
    await settleDialog();
    type(overlay().querySelector('ui-field input') as HTMLInputElement, 'Ada L');
    await settleDialog();
    dialogButton(`${EDITOR}.saveAndCommit`)?.click();
    await settleDialog();

    expect(answer).toBeUndefined();
    expect(overlay().querySelector('ui-inline-banner')).not.toBeNull();

    dialogButton(`${EDITOR}.cancel`)?.click();
    await settleDialog();

    expect(answer).toBe(false);
  });

  it('fails when the author cannot be read, so that the form offers another try', async () => {
    start(unconfirmed);
    api['repositoryCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));

    await expect(gate.ready()).rejects.toBeDefined();
    expect(question()).toBeNull();
  });

  describe('reads the author again', () => {
    it('reads the author again on git.changed and after Change', async () => {
      start(confirmed, work);
      await settleDialog();

      events.next({ type: 'git.changed', repositoryId: 12 });
      await settleDialog();
      expect(gate.author()).toEqual(work);

      api['repositoryCommitAuthor'].mockReturnValueOnce(of(work));
      const change = gate.change();
      await settleDialog();
      dialogButton(`${EDITOR}.save`)?.click();
      await change;

      expect(api['repositoryCommitAuthor']).toHaveBeenCalledTimes(3);
      expect(gate.author()).toEqual(work);
    });

    it('on a (re)connect, as a change of the default has no event', async () => {
      start(confirmed, work);
      await settleDialog();

      reconnected.next();
      await settleDialog();

      expect(gate.author()).toEqual(work);
    });

    it('not for another repository\'s event', async () => {
      start(confirmed);
      await settleDialog();

      events.next({ type: 'git.changed', repositoryId: 13 });

      expect(api['repositoryCommitAuthor']).toHaveBeenCalledTimes(1);
    });

    it('when the question is cancelled, as Change may have saved an override', async () => {
      start(unconfirmed, unconfirmed, work);

      const ready = gate.ready();
      await settleDialog();
      dialogButton(`${QUESTION}.cancel`)?.click();
      await ready;

      expect(gate.author()).toEqual(work);
    });
  });

  it('shows nothing of the last repository, and ignores a read that comes after leaving it', async () => {
    const late = new Subject<RepositoryCommitAuthor>();
    api['repositoryCommitAuthor'].mockReturnValueOnce(late);
    gate = TestBed.inject(CommitAuthorGate);
    TestBed.tick();

    followed.set(99);
    TestBed.tick();
    late.next(work);
    late.complete();
    await settleDialog();

    expect(gate.author()).toBeNull();
  });

  it('keeps the last author when a read fails', async () => {
    start(work);
    await settleDialog();
    api['repositoryCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));

    events.next({ type: 'git.changed', repositoryId: 12 });
    await settleDialog();

    expect(gate.author()).toEqual(work);
  });

  describe('readFailed', () => {
    async function startFailing(): Promise<void> {
      api['repositoryCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
      gate = TestBed.inject(CommitAuthorGate);
      TestBed.tick();
      await settleDialog();
    }

    it('says so when the first read fails', async () => {
      await startFailing();

      expect(gate.author()).toBeNull();
      expect(gate.readFailed()).toBe(true);
    });

    it('goes when a read succeeds, as with Try again', async () => {
      await startFailing();

      gate.refresh();
      await settleDialog();

      expect(gate.author()).toEqual(confirmed);
      expect(gate.readFailed()).toBe(false);
    });

    it('stays false while the last author is shown, when a later read fails', async () => {
      start(work);
      await settleDialog();
      api['repositoryCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));

      gate.refresh();
      await settleDialog();

      expect(gate.author()).toEqual(work);
      expect(gate.readFailed()).toBe(false);
    });

    it('starts again in the next repository', async () => {
      await startFailing();
      api['repositoryCommitAuthor'].mockReturnValueOnce(new Subject());

      followed.set(99);
      TestBed.tick();
      await settleDialog();

      expect(gate.readFailed()).toBe(false);
    });

    it('ignores a failure that a newer read has overtaken', async () => {
      const late = new Subject<RepositoryCommitAuthor>();
      api['repositoryCommitAuthor'].mockReturnValueOnce(late);
      gate = TestBed.inject(CommitAuthorGate);
      TestBed.tick();

      gate.refresh();
      late.error(apiError(500, 'internal'));
      await settleDialog();

      expect(gate.readFailed()).toBe(false);
      expect(gate.author()).toEqual(confirmed);
    });
  });

  it('change does nothing before an author is known', async () => {
    api['repositoryCommitAuthor'].mockReturnValueOnce(new Subject());
    gate = TestBed.inject(CommitAuthorGate);
    TestBed.tick();

    await gate.change();

    expect(document.querySelector('dlg-change-commit-author')).toBeNull();
  });
});
