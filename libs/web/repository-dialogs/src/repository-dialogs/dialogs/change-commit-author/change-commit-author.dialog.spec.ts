import { TestBed } from '@angular/core/testing';
import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { firstValueFrom, of, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import type { CommitAuthorDialogData } from '../../models/commit-author-dialog.model';
import { ChangeCommitAuthorDialog } from './change-commit-author.dialog';

const KEY = 'web-repository-dialogs.CommitAuthorEditorComponent';
const LABELS = 'web-repository-dialogs.commitAuthor';
const ERRORS = 'web-repository-dialogs.errors';

const ada = { name: 'Ada', email: 'ada@example.com' };
const work = { name: 'Ada L', email: 'ada@work.example' };
const usingDefault: RepositoryCommitAuthor = { author: ada, source: 'default', confirmed: true };
const usingOverride: RepositoryCommitAuthor = { author: work, source: 'override', confirmed: true };

describe('ChangeCommitAuthorDialog', () => {
  let ref: DialogRef<RepositoryCommitAuthor>;
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
      .find(element => element.textContent?.trim() === `${KEY}.${label}`)?.querySelector('input') as HTMLInputElement;

  async function open(current: RepositoryCommitAuthor): Promise<void> {
    ref = TestBed.inject(DialogService).open<ChangeCommitAuthorDialog, CommitAuthorDialogData, RepositoryCommitAuthor>(
      ChangeCommitAuthorDialog,
      { data: { repositoryId: 12, current } }
    );
    await settleDialog();
  }

  async function save(): Promise<void> {
    dialogButton(`${KEY}.save`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    api = {
      commitAuthor: vi.fn(() => of({ author: ada, confirmed: true })),
      setCommitAuthor: vi.fn(() => of({ author: work, confirmed: true })),
      setRepositoryCommitAuthor: vi.fn(() => of(usingOverride)),
      removeRepositoryCommitAuthor: vi.fn(() => of({ author: work, source: 'default', confirmed: true })),
      confirmCommitAuthor: vi.fn(() => of(undefined))
    };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [ { provide: PreferencesApi, useValue: api } ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('moves the focus to the name, with the author in the fields', async () => {
    await open(usingDefault);

    expect(document.activeElement).toBe(input('name'));
    expect(input('name').value).toBe('Ada');
    expect(input('email').value).toBe('ada@example.com');
  });

  it('starts with as my default, without an override', async () => {
    await open(usingDefault);

    expect(radio('asDefault').checked).toBe(true);
    expect(overlay().textContent).not.toContain(`${KEY}.dropsOverride`);
  });

  it('starts with for this repository, with an override', async () => {
    await open(usingOverride);

    expect(radio('forRepository').checked).toBe(true);
  });

  it('Change saves as the default', async () => {
    await open(usingDefault);
    const closed = firstValueFrom(ref.closed);
    type(input('name'), 'Ada L');
    type(input('email'), 'ada@work.example');
    await settleDialog();

    await save();

    expect(api['setCommitAuthor']).toHaveBeenCalledWith(work);
    expect(api['setRepositoryCommitAuthor']).not.toHaveBeenCalled();
    expect(await closed).toEqual({ author: work, source: 'default', confirmed: true });
  });

  it('Change saves for this repository, which does not confirm', async () => {
    await open(usingDefault);
    const closed = firstValueFrom(ref.closed);
    type(input('name'), 'Ada L');
    type(input('email'), 'ada@work.example');
    radio('forRepository').click();
    await settleDialog();

    await save();

    expect(api['setRepositoryCommitAuthor']).toHaveBeenCalledWith(12, work);
    expect(api['setCommitAuthor']).not.toHaveBeenCalled();
    expect(api['confirmCommitAuthor']).not.toHaveBeenCalled();
    expect(await closed).toEqual(usingOverride);
  });

  it('as my default drops the override, and says so, so that the commit records what was typed', async () => {
    await open(usingOverride);
    const closed = firstValueFrom(ref.closed);
    radio('asDefault').click();
    await settleDialog();
    expect(overlay().textContent).toContain(`${KEY}.dropsOverride`);

    await save();

    expect(api['setCommitAuthor']).toHaveBeenCalledWith(work);
    expect(api['removeRepositoryCommitAuthor']).toHaveBeenCalledWith(12);
    expect(await closed).toEqual({ author: work, source: 'default', confirmed: true });
  });

  it('saving the default without an edit changes nothing, so that the first commit still asks', async () => {
    const unconfirmed: RepositoryCommitAuthor = { ...usingDefault, confirmed: false };
    await open(unconfirmed);
    const closed = firstValueFrom(ref.closed);

    await save();

    expect(api['setCommitAuthor']).not.toHaveBeenCalled();
    expect(await closed).toEqual(unconfirmed);
  });

  it('says what was saved when removing the override fails after the default was saved', async () => {
    api['removeRepositoryCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    await open(usingOverride);
    radio('asDefault').click();
    await settleDialog();

    await save();

    expect(overlay().querySelector('ui-inline-banner')?.textContent).toContain(`${KEY}.defaultSaved`);
    expect(overlay().querySelector('dlg-change-commit-author')).not.toBeNull();
  });

  it('does not say that anything was saved when the first request fails', async () => {
    api['setCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    await open(usingOverride);
    radio('asDefault').click();
    await settleDialog();

    await save();

    expect(overlay().querySelector('ui-inline-banner')?.textContent).not.toContain(`${KEY}.defaultSaved`);
  });

  it('shows a refusal next to the field, and stays open', async () => {
    api['setCommitAuthor'].mockReturnValueOnce(
      throwError(() => apiError(400, 'validation-failed', [ { path: 'email', code: 'email-invalid' } ]))
    );
    await open(usingDefault);
    type(input('name'), 'Ada L');
    await settleDialog();

    await save();

    expect(field('email').querySelector('.error')?.textContent?.trim()).toBe(`${ERRORS}.email.email-invalid`);
    expect(document.activeElement).toBe(input('email'));
    expect(overlay().querySelector('dlg-change-commit-author')).not.toBeNull();
  });

  it('refuses what CA-10 refuses without asking the backend', async () => {
    await open(usingDefault);
    type(input('email'), 'no at sign');
    await settleDialog();

    await save();

    expect(api['setCommitAuthor']).not.toHaveBeenCalled();
    expect(overlay().querySelector('dlg-change-commit-author')).not.toBeNull();
  });

  it('shows any other failure above the buttons, and stays open', async () => {
    api['setCommitAuthor'].mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    await open(usingDefault);
    type(input('name'), 'Ada L');
    await settleDialog();

    await save();

    expect(overlay().querySelector('ui-inline-banner')).not.toBeNull();
    expect(overlay().querySelector('dlg-change-commit-author')).not.toBeNull();
  });

  it('closes with nothing on Cancel, saving nothing', async () => {
    await open(usingDefault);
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${KEY}.cancel`)?.click();

    expect(await closed).toBeUndefined();
    expect(api['setCommitAuthor']).not.toHaveBeenCalled();
  });
});
