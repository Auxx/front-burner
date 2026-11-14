import { TestBed } from '@angular/core/testing';
import { DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MarkersLeftDialog } from './markers-left.dialog';

const K = 'web-feature-repository-screen.MarkersLeftDialog';

describe('MarkersLeftDialog', () => {
  /** Opens the dialog and waits for it to render; `closed` settles when it closes. */
  async function open(): Promise<{ closed: Promise<boolean | undefined>; }> {
    TestBed.configureTestingModule({ imports: [ translocoTesting() ] });
    const ref = TestBed.inject(DialogService).open<
      MarkersLeftDialog,
      void,
      boolean
    >(MarkersLeftDialog);
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });
    await settleDialog();
    return { closed };
  }

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('asks whether to mark the file as resolved anyway, with the focus on Cancel', async () => {
    await open();

    expect(overlay().querySelector('h2')?.textContent).toContain(
      `${K}.heading`
    );
    expect(overlay().querySelector('.message')?.textContent).toContain(
      `${K}.message`
    );
    expect(document.activeElement).toBe(dialogButton(`${K}.cancel`));
  });

  it('closes with true on Mark as resolved', async () => {
    const { closed } = await open();

    dialogButton(`${K}.markResolved`)?.click();

    expect(await closed).toBe(true);
  });

  it('closes with false on Cancel', async () => {
    const { closed } = await open();

    dialogButton(`${K}.cancel`)?.click();

    expect(await closed).toBe(false);
  });
});
