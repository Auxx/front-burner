import { TestBed } from '@angular/core/testing';
import { DialogRef, DialogService } from '@front-burner/ui';
import { CredentialsApi } from '@front-burner/web-api-client';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { UnlockKeyDialog, type UnlockKeyDialogData } from './unlock-key.dialog';

const KEY = 'web-repository-dialogs.UnlockKeyDialog';

const laptop: UnlockKeyDialogData = {
  id: 3,
  name: 'laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'
};

describe('UnlockKeyDialog', () => {
  let ref: DialogRef<boolean>;
  let api: { unlockSshKey: ReturnType<typeof vi.fn>; };

  const field = () => overlay().querySelector('ui-field') as HTMLElement;
  const input = () => field().querySelector('input') as HTMLInputElement;
  const fieldError = () => field().querySelector('.error')?.textContent?.trim();

  async function open(): Promise<void> {
    ref = TestBed.inject(DialogService).open<UnlockKeyDialog, UnlockKeyDialogData, boolean>(UnlockKeyDialog, {
      data: laptop
    });
    await settleDialog();
  }

  async function unlock(): Promise<void> {
    dialogButton(`${KEY}.unlock`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    api = { unlockSshKey: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [ { provide: CredentialsApi, useValue: api } ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('shows the key\'s name, type and fingerprint', async () => {
    await open();

    const values = [ ...overlay().querySelectorAll('[uiKeyValue]') ].map(element => element.textContent);
    expect(values.some(text => text?.includes('laptop'))).toBe(true);
    expect(values.some(text => text?.includes(`${KEY}.keyTypes.ed25519`))).toBe(true);
    expect(values.some(text => text?.includes(laptop.fingerprint))).toBe(true);
  });

  it('the passphrase is required and masked', async () => {
    await open();

    expect(input().type).toBe('password');
    expect(input().autocomplete).toBe('off');

    await unlock();

    expect(fieldError()).toBe(`${KEY}.errors.required`);
    expect(api.unlockSshKey).not.toHaveBeenCalled();
  });

  it('unlocks the key and closes with true', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);
    type(input(), 'correct horse');
    await settleDialog();

    await unlock();

    expect(api.unlockSshKey).toHaveBeenCalledWith(3, { passphrase: 'correct horse' });
    expect(await closed).toBe(true);
  });

  it('shows Wrong passphrase on the field', async () => {
    api.unlockSshKey.mockReturnValueOnce(
      throwError(() => apiError(422, 'validation-failed', [ { path: 'passphrase', code: 'wrong-passphrase' } ]))
    );
    await open();
    type(input(), 'wrong');
    await settleDialog();

    await unlock();

    expect(fieldError()).toBe(`${KEY}.errors.wrong-passphrase`);
    expect(document.activeElement).toBe(input());
    expect(overlay().querySelector('dlg-unlock-key')).not.toBeNull();
  });

  it('AC-REPO-002.10: shows Too many attempts on the field', async () => {
    api.unlockSshKey.mockReturnValueOnce(throwError(() => apiError(429, 'unlock-too-many-attempts')));
    await open();
    type(input(), 'wrong');
    await settleDialog();

    await unlock();

    expect(fieldError()).toBe(`${KEY}.errors.unlock-too-many-attempts`);
    expect(overlay().querySelector('ui-inline-banner')).toBeNull();
  });

  it('shows any other failure above the buttons, and stays open', async () => {
    api.unlockSshKey.mockReturnValueOnce(throwError(() => apiError(500, 'internal')));
    await open();
    type(input(), 'correct horse');
    await settleDialog();

    await unlock();

    expect(overlay().querySelector('ui-inline-banner')).not.toBeNull();
    expect(fieldError()).toBeUndefined();
    expect(overlay().querySelector('dlg-unlock-key')).not.toBeNull();
  });

  it('sends one attempt for two quick submits', async () => {
    const answer = new Subject<void>();
    api.unlockSshKey.mockReturnValue(answer);
    await open();
    type(input(), 'correct horse');
    await settleDialog();
    const form = overlay().querySelector('form') as HTMLFormElement;

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settleDialog();

    expect(api.unlockSshKey).toHaveBeenCalledTimes(1);
    answer.next();
    answer.complete();
  });

  it('moves focus to the field and returns it on closing', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await open();

    expect(document.activeElement).toBe(input());

    dialogButton(`${KEY}.cancel`)?.click();
    await settleDialog();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('closes with nothing on Cancel, sending nothing', async () => {
    await open();
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${KEY}.cancel`)?.click();

    expect(await closed).toBeUndefined();
    expect(api.unlockSshKey).not.toHaveBeenCalled();
  });
});
