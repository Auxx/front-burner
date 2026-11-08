import { TestBed } from '@angular/core/testing';
import { DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AbortMergeDialog } from './abort-merge.dialog';

const K = 'web-feature-repository-screen.AbortMergeDialog';

describe('AbortMergeDialog', () => {
  async function open(): Promise<Promise<boolean | undefined>> {
    TestBed.configureTestingModule({ imports: [ translocoTesting() ] });
    const ref = TestBed.inject(DialogService).open<AbortMergeDialog, void, boolean>(AbortMergeDialog);
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });
    await settleDialog();
    return closed;
  }

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('asks, saying what is lost, with the focus on Cancel', async () => {
    void open();
    await settleDialog();

    expect(overlay().querySelector('h2')?.textContent).toContain(`${K}.heading`);
    expect(overlay().querySelector('.message')?.textContent).toContain(`${K}.message`);
    expect(document.activeElement).toBe(dialogButton(`${K}.cancel`));
  });

  it('closes with true on Abort merge', async () => {
    const closed = open();
    await settleDialog();

    dialogButton(`${K}.abort`)?.click();

    expect(await (await closed)).toBe(true);
  });

  it('closes with false on Cancel', async () => {
    const closed = open();
    await settleDialog();

    dialogButton(`${K}.cancel`)?.click();

    expect(await (await closed)).toBe(false);
  });
});
