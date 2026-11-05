import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { DialogRef, DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { apiError, dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type DiscardChangesData, DiscardChangesDialog } from './discard-changes.dialog';

const K = 'web-feature-repository-screen.DiscardChangesDialog';

describe('DiscardChangesDialog', () => {
  let ref: DialogRef<boolean>;
  let discard: ReturnType<typeof vi.fn<() => Promise<void>>>;

  const heading = () => overlay().querySelector('h2')?.textContent?.trim();
  const banner = () => overlay().querySelector('ui-inline-banner')?.textContent?.trim();

  async function open(count: number): Promise<void> {
    ref = TestBed.inject(DialogService).open<DiscardChangesDialog, DiscardChangesData, boolean>(DiscardChangesDialog, {
      data: { count, discard }
    });
    await settleDialog();
  }

  beforeEach(() => {
    discard = vi.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${K}.heading`]: 'Discard changes to {{ count }} file?',
          [`${K}.headingAll`]: 'Discard changes to all {{ count }} files?'
        })
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('says how many files, and that the changes cannot be recovered', async () => {
    await open(1);

    expect(heading()).toBe('Discard changes to 1 file?');
    expect(overlay().querySelector('p')?.textContent?.trim()).toBe(`${K}.message`);
  });

  it('says all when there are several files', async () => {
    await open(3);

    expect(heading()).toBe('Discard changes to all 3 files?');
  });

  it('has a danger button, and Cancel has the focus', async () => {
    await open(1);

    expect(dialogButton(`${K}.discard`)?.getAttribute('data-variant')).toBe('danger');
    expect(document.activeElement).toBe(dialogButton(`${K}.cancel`));
  });

  it('discards and closes with true', async () => {
    await open(1);
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.discard`)?.click();

    expect(await closed).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('closes with false on Cancel, without discarding', async () => {
    await open(1);
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.cancel`)?.click();

    expect(await closed).toBe(false);
    expect(discard).not.toHaveBeenCalled();
  });

  it.each(
    [
      [ 'network', new HttpErrorResponse({ status: 0 }) ],
      [ 'server', apiError(500, 'internal') ]
    ] as const
  )('stays open with the error and offers Try again after a %s error', async (_name, error) => {
    discard.mockRejectedValueOnce(error);
    await open(1);
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.discard`)?.click();
    await settleDialog();

    expect(overlay().querySelector('rs-discard-changes')).not.toBeNull();
    expect(banner()).toBeTruthy();
    expect(dialogButton(`${K}.discard`)).toBeUndefined();

    dialogButton(`${K}.retry`)?.click();

    expect(await closed).toBe(true);
    expect(discard).toHaveBeenCalledTimes(2);
  });

  it.each([ [ 409, 'discard-blocked' ], [ 400, 'path-refused' ] ])(
    'shows a refusal without Try again: %s %s',
    async (status, code) => {
      discard.mockRejectedValueOnce(apiError(status, code));
      await open(1);

      dialogButton(`${K}.discard`)?.click();
      await settleDialog();

      expect(banner()).toContain(code);
      expect(dialogButton(`${K}.retry`)).toBeUndefined();
      expect(dialogButton(`${K}.discard`)).toBeUndefined();
      expect(dialogButton(`${K}.cancel`)).toBeDefined();
    }
  );

  it('keeps the focus on the button that is pressed, which becomes Try again', async () => {
    discard.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await open(1);
    dialogButton(`${K}.discard`)?.focus();

    dialogButton(`${K}.discard`)?.click();
    await settleDialog();

    expect(document.activeElement).toBe(dialogButton(`${K}.retry`));
  });

  it('moves the focus to Cancel after a refusal, as the button pressed is gone', async () => {
    discard.mockRejectedValueOnce(apiError(409, 'discard-blocked'));
    await open(1);
    dialogButton(`${K}.discard`)?.focus();

    dialogButton(`${K}.discard`)?.click();
    await settleDialog();

    expect(document.activeElement).toBe(dialogButton(`${K}.cancel`));
  });

  it('cannot be dismissed while the discard runs', async () => {
    let finish!: () => void;
    discard.mockReturnValueOnce(new Promise(resolve => (finish = resolve)));
    await open(1);

    dialogButton(`${K}.discard`)?.click();
    await settleDialog();

    expect(ref.dismissible()).toBe(false);
    finish();
    await settleDialog();
  });
});
