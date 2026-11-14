import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ApiError, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { dialogButton, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type CommitMergeData, CommitMergeDialog, type CommitMergeOutcome } from './commit-merge.dialog';

const K = 'web-feature-repository-screen.CommitMergeDialog';
const author: RepositoryCommitAuthor = {
  author: { name: 'Ada', email: 'ada@example.com' },
  confirmed: true
} as RepositoryCommitAuthor;
const failed: ApiError = {
  code: 'merge-unresolved',
  params: {},
  requestId: 'abcdef0123456789',
  message: 'merge-unresolved'
};

describe('CommitMergeDialog', () => {
  let ended: ReturnType<typeof signal<boolean>>;
  let shownAuthor: ReturnType<typeof signal<RepositoryCommitAuthor | null>>;
  let commits: string[];
  let answer: () => Promise<CommitMergeOutcome>;
  let changeAuthor: ReturnType<typeof vi.fn<() => Promise<void>>>;

  const field = () => overlay().querySelector('textarea') as HTMLTextAreaElement;
  const text = () => overlay().textContent?.replace(/\s+/g, ' ') ?? '';

  /** Opens the dialog from a focused trigger; `closed` settles when it closes. */
  async function open(): Promise<{ closed: Promise<unknown>; trigger: HTMLButtonElement; }> {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const data: CommitMergeData = {
      message: 'Merge remote-tracking branch \'origin/main\'',
      author: shownAuthor,
      authorFailed: signal(false),
      ended,
      changeAuthor,
      commit: message => {
        commits.push(message);
        return answer();
      }
    };
    const ref = TestBed.inject(DialogService).open<CommitMergeDialog, CommitMergeData, void>(CommitMergeDialog, {
      data
    });
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined }).then(() => 'closed');
    await settleDialog();
    return { closed, trigger };
  }

  async function press(): Promise<void> {
    dialogButton(`${K}.commit`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    ended = signal(false);
    shownAuthor = signal<RepositoryCommitAuthor | null>(author);
    commits = [];
    answer = async () => 'committed';
    changeAuthor = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${K}.committingAs`]: 'Committing as {{ name }} <{{ email }}>',
          'errors.merge-unresolved': 'Resolve every conflicting file before committing the merge.'
        })
      ]
    });
  });

  afterEach(() => {
    TestBed.inject(DialogService).closeAll();
    document.body.querySelectorAll(':scope > button').forEach(button => button.remove());
  });

  it('starts with git\'s message, and commits it as edited', async () => {
    const { closed } = await open();

    expect(field().value).toBe('Merge remote-tracking branch \'origin/main\'');

    type(field() as unknown as HTMLInputElement, 'Merge origin/main, edited');
    await press();

    expect(commits).toEqual([ 'Merge origin/main, edited' ]);
    expect(await closed).toBe('closed');
  });

  it('refuses an empty message', async () => {
    await open();
    type(field() as unknown as HTMLInputElement, '   \n ');

    await press();

    expect(commits).toEqual([]);
    expect(text()).toContain(`${K}.needsMessage`);
    expect(document.activeElement).toBe(field());
  });

  it('says who commits, and Change changes it', async () => {
    await open();

    expect(text()).toContain('Committing as Ada <ada@example.com>');
    dialogButton(`${K}.change`)?.click();
    await settleDialog();

    expect(changeAuthor).toHaveBeenCalledOnce();
  });

  it('stays open, with the message, when the author question is cancelled', async () => {
    answer = async () => 'cancelled';
    const { closed } = await open();
    let state = 'open';
    void closed.then(() => (state = 'closed'));

    await press();

    expect(state).toBe('open');
    expect(field().value).toBe('Merge remote-tracking branch \'origin/main\'');
    expect(text()).not.toContain('Reference');
  });

  it('keeps the message after a failure, and says why with its reference', async () => {
    answer = async () => ({ error: failed });
    await open();
    type(field() as unknown as HTMLInputElement, 'Edited');

    await press();

    expect(text()).toContain('Resolve every conflicting file before committing the merge.');
    expect(text()).toContain('abcdef01');
    expect(field().value).toBe('Edited');

    answer = async () => 'committed';
    await press();

    expect(commits).toEqual([ 'Edited', 'Edited' ]);
  });

  it('closes when the merge ends elsewhere, saying nothing', async () => {
    const { closed } = await open();

    ended.set(true);
    await settleDialog();

    expect(await closed).toBe('closed');
    expect(overlay().querySelector('rs-commit-merge')).toBeNull();
  });

  it('moves focus to the message, and returns it', async () => {
    const { trigger } = await open();

    expect(document.activeElement).toBe(field());

    dialogButton(`${K}.cancel`)?.click();
    await settleDialog();

    expect(document.activeElement).toBe(trigger);
  });
});
