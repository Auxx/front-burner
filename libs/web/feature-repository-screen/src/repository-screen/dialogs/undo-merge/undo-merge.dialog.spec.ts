import { TestBed } from '@angular/core/testing';
import { DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { UndoMergeDialog } from './undo-merge.dialog';

const K = 'web-feature-repository-screen.UndoMergeDialog';

describe('UndoMergeDialog', () => {
  /** Opens the dialog and waits for it to render; `closed` settles when it closes. */
  async function open(): Promise<{ closed: Promise<boolean | undefined>; }> {
    TestBed.configureTestingModule({ imports: [ translocoTesting() ] });
    const ref = TestBed.inject(DialogService).open<UndoMergeDialog, void, boolean>(UndoMergeDialog);
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });
    await settleDialog();
    return { closed };
  }

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('asks, saying what happens to the branch, with the focus on Cancel', async () => {
    await open();

    expect(overlay().querySelector('h2')?.textContent).toContain(`${K}.heading`);
    expect(overlay().querySelector('.message')?.textContent).toContain(`${K}.message`);
    expect(document.activeElement).toBe(dialogButton(`${K}.cancel`));
  });

  it('closes with true on Undo merge', async () => {
    const { closed } = await open();

    dialogButton(`${K}.undo`)?.click();

    expect(await closed).toBe(true);
  });

  it('closes with false on Cancel', async () => {
    const { closed } = await open();

    dialogButton(`${K}.cancel`)?.click();

    expect(await closed).toBe(false);
  });
});
