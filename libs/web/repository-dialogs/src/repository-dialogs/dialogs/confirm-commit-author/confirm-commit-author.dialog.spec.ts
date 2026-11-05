import { TestBed } from '@angular/core/testing';
import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { firstValueFrom, of, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import type { CommitAuthorDialogData } from '../../models/commit-author-dialog.model';
import { type CommitAuthorConfirmed, ConfirmCommitAuthorDialog } from './confirm-commit-author.dialog';

const KEY = 'web-repository-dialogs.ConfirmCommitAuthorDialog';
const EDITOR = 'web-repository-dialogs.CommitAuthorEditorComponent';
const HELP = 'web-repository-dialogs.CommitAuthorFormComponent';
const LABELS = 'web-repository-dialogs.commitAuthor';
const ERRORS = 'web-repository-dialogs.errors';

const ada = { name: 'Ada', email: 'ada@example.com' };
const unconfirmed: RepositoryCommitAuthor = { author: ada, source: 'default', confirmed: false };
const COMMIT_AS = 'Commit as Ada <ada@example.com>';

describe('ConfirmCommitAuthorDialog', () => {
  let ref: DialogRef<CommitAuthorConfirmed>;
  let api: Record<
    | 'commitAuthor'
    | 'setCommitAuthor'
    | 'setRepositoryCommitAuthor'
    | 'removeRepositoryCommitAuthor'
    | 'confirmCommitAuthor',
    ReturnType<typeof vi.fn>
  >;

  const field = (label: string) =>
    [ ...overlay().querySelectorAll<HTMLElement>('ui-field') ]
      .find(element => element.querySelector('.label')?.textContent?.trim() === `${LABELS}.${label}`) as HTMLElement;
  const input = (label: string) => field(label).querySelector('input') as HTMLInputElement;
  const radio = (label: string) =>
    [ ...overlay().querySelectorAll<HTMLLabelElement>('ui-segmented-control label') ]
      .find(element => element.textContent?.trim() === `${EDITOR}.${label}`)?.querySelector(
        'input'
      ) as HTMLInputElement;

  async function open(current = unconfirmed): Promise<void> {
    ref = TestBed.inject(DialogService).open<ConfirmCommitAuthorDialog, CommitAuthorDialogData, CommitAuthorConfirmed>(
      ConfirmCommitAuthorDialog,
      { data: { repositoryId: 12, current } }
    );
    await settleDialog();
  }

  beforeEach(() => {
    api = {
      commitAuthor: vi.fn(() => of({ author: ada, confirmed: false })),
      setCommitAuthor: vi.fn(() => of({ author: ada, confirmed: true })),
      setRepositoryCommitAuthor: vi.fn(() => of({ author: ada, source: 'override', confirmed: false })),
      removeRepositoryCommitAuthor: vi.fn(() => of({ author: ada, source: 'default', confirmed: true })),
      confirmCommitAuthor: vi.fn(() => of(undefined))
    };
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ [`${KEY}.commitAs`]: 'Commit as {{ name }} <{{ email }}>' }) ],
      providers: [ { provide: PreferencesApi, useValue: api } ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('offers Commit as the author, and Change', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);

    expect(dialogButton(`${KEY}.change`)).toBeDefined();
    dialogButton(COMMIT_AS)?.click();

    expect(await closed).toBe('confirmed');
    expect(api['confirmCommitAuthor']).toHaveBeenCalledTimes(1);
    expect(api['setCommitAuthor']).not.toHaveBeenCalled();
  });

  it('moves the focus to its first button', async () => {
    await open();

    expect(document.activeElement).toBe(dialogButton(`${KEY}.cancel`));
  });

  it('shows the author as text', async () => {
    const name = 'O\'Brien & "Sons" <b>';
    await open({ ...unconfirmed, author: { name, email: 'a@b' } });

    expect(dialogButton(`Commit as ${name} <a@b>`)).toBeDefined();
    expect(overlay().querySelector('button b')).toBeNull();
  });

  it('explains the email, with the providers\' links', async () => {
    await open();

    expect(overlay().textContent).toContain(`${HELP}.emailHint`);
    const links = [ ...overlay().querySelectorAll('a') ].map(link => link.getAttribute('href'));
    expect(links.some(link => link?.includes('docs.github.com'))).toBe(true);
    expect(links.some(link => link?.includes('support.atlassian.com'))).toBe(true);
  });

  it('closes with nothing on Cancel, confirming nothing', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${KEY}.cancel`)?.click();

    expect(await closed).toBeUndefined();
    expect(api['confirmCommitAuthor']).not.toHaveBeenCalled();
  });

  it('stays open with the reason when confirming fails, and can try again', async () => {
    api['confirmCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    await open();
    const closed = firstValueFrom(ref.closed);

    dialogButton(COMMIT_AS)?.click();
    await settleDialog();

    expect(overlay().querySelector('ui-inline-banner')).not.toBeNull();
    dialogButton(COMMIT_AS)?.click();

    expect(await closed).toBe('confirmed');
  });

  it('opens the form in place on Change, with the focus on the name', async () => {
    await open();

    dialogButton(`${KEY}.change`)?.click();
    await settleDialog();

    expect(overlay().querySelectorAll('ui-dialog').length).toBe(1);
    expect(input('name').value).toBe('Ada');
    expect(document.activeElement).toBe(input('name'));
  });

  it('Change as the default confirms by saving, and goes on', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);
    dialogButton(`${KEY}.change`)?.click();
    await settleDialog();
    type(input('name'), 'Ada L');
    await settleDialog();

    dialogButton(`${EDITOR}.saveAndCommit`)?.click();

    expect(await closed).toBe('confirmed');
    expect(api['setCommitAuthor']).toHaveBeenCalledWith({ ...ada, name: 'Ada L' });
    expect(api['confirmCommitAuthor']).not.toHaveBeenCalled();
  });

  it('Change for this repository saves the override, then confirms', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);
    dialogButton(`${KEY}.change`)?.click();
    await settleDialog();
    radio('forRepository').click();
    await settleDialog();

    dialogButton(`${EDITOR}.saveAndCommit`)?.click();

    expect(await closed).toBe('confirmed');
    expect(api['setRepositoryCommitAuthor']).toHaveBeenCalledWith(12, ada);
    expect(api['confirmCommitAuthor']).toHaveBeenCalledTimes(1);
    expect(api['setRepositoryCommitAuthor'].mock.invocationCallOrder[0])
      .toBeLessThan(api['confirmCommitAuthor'].mock.invocationCallOrder[0]);
  });

  it('does not go on when the override is saved but confirming fails', async () => {
    api['confirmCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    await open();
    dialogButton(`${KEY}.change`)?.click();
    await settleDialog();
    radio('forRepository').click();
    await settleDialog();
    let closed = false;
    ref.closed.subscribe(() => (closed = true));

    dialogButton(`${EDITOR}.saveAndCommit`)?.click();
    await settleDialog();

    expect(closed).toBe(false);
    expect(overlay().querySelector('ui-inline-banner')).not.toBeNull();
  });

  it('shows a default that breaks CA-10 in the form, with the reason next to the field', async () => {
    const broken = { name: 'Ada', email: 'not an email' };
    api['commitAuthor'].mockReturnValue(of({ author: broken, confirmed: false }));
    api['confirmCommitAuthor'].mockReturnValueOnce(
      throwError(() => apiError(400, 'validation-failed', [ { path: 'email', code: 'email-invalid' } ]))
    );
    await open({ author: broken, source: 'default', confirmed: false });

    dialogButton('Commit as Ada <not an email>')?.click();
    await settleDialog();

    expect(input('email').value).toBe('not an email');
    expect(field('email').querySelector('.error')?.textContent?.trim()).toBe(`${ERRORS}.email.email-invalid`);
    expect(overlay().textContent).toContain(`${EDITOR}.fixDefault`);
    expect(overlay().querySelector('ui-segmented-control')).toBeNull();
  });

  it('moves on to the default when the backend refuses to confirm it, and leaves the override', async () => {
    const work = { name: 'Ada L', email: 'ada@work.example' };
    const broken = { name: 'Ada', email: 'not an email' };
    api['commitAuthor'].mockReturnValue(of({ author: broken, confirmed: false }));
    api['setRepositoryCommitAuthor'].mockReturnValue(of({ author: work, source: 'override', confirmed: false }));
    api['confirmCommitAuthor'].mockReturnValue(
      throwError(() => apiError(400, 'validation-failed', [ { path: 'email', code: 'email-invalid' } ]))
    );
    await open({ author: work, source: 'override', confirmed: false });
    dialogButton(`${KEY}.change`)?.click();
    await settleDialog();

    dialogButton(`${EDITOR}.saveAndCommit`)?.click();
    await settleDialog();

    expect(input('email').value).toBe('not an email');
    expect(field('email').querySelector('.error')?.textContent?.trim()).toBe(`${ERRORS}.email.email-invalid`);

    const closed = firstValueFrom(ref.closed);
    type(input('email'), 'ada@example.com');
    await settleDialog();
    dialogButton(`${EDITOR}.saveAndCommit`)?.click();

    expect(await closed).toBe('confirmed');
    expect(api['setCommitAuthor']).toHaveBeenCalledWith({ name: 'Ada', email: 'ada@example.com' });
    expect(api['removeRepositoryCommitAuthor']).not.toHaveBeenCalled();
  });
});
