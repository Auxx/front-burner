import { TestBed } from '@angular/core/testing';
import { DialogRef, DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { dialogButton, overlay, settleDialog } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type SwitchRefusedData, SwitchRefusedDialog } from './switch-refused.dialog';

const K = 'web-feature-repository-screen.SwitchRefusedDialog';

describe('SwitchRefusedDialog', () => {
  let ref: DialogRef<boolean>;

  const rows = () => [ ...overlay().querySelectorAll('li') ].map(row => row.textContent?.trim());

  async function open(paths: readonly string[] | null): Promise<void> {
    ref = TestBed.inject(DialogService).open<SwitchRefusedDialog, SwitchRefusedData, boolean>(SwitchRefusedDialog, {
      data: { paths }
    });
    await settleDialog();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ [`${K}.more`]: 'and {{ hidden }} more' }) ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('says why, with the changed files', async () => {
    await open([ 'docs/guide.md', 'README.md' ]);

    expect(overlay().querySelector('h2')?.textContent?.trim()).toBe(`${K}.heading`);
    expect(overlay().querySelector('p')?.textContent?.trim()).toBe(`${K}.message`);
    expect(rows()).toEqual([ 'docs/guide.md', 'README.md' ]);
  });

  it('names the list after the message', async () => {
    await open([ 'README.md' ]);

    const list = overlay().querySelector('ul') as HTMLElement;

    expect(overlay().querySelector(`#${list.getAttribute('aria-labelledby')}`)?.textContent?.trim()).toBe(
      `${K}.message`
    );
  });

  it('has no list when no file has changed any more', async () => {
    await open([]);

    expect(overlay().querySelector('p')?.textContent?.trim()).toBe(`${K}.message`);
    expect(overlay().querySelector('ul')).toBeNull();
    expect(overlay().textContent).not.toContain(`${K}.listFailed`);
  });

  it('says so when the files could not be read', async () => {
    await open(null);

    expect(overlay().textContent).toContain(`${K}.message`);
    expect(overlay().textContent).toContain(`${K}.listFailed`);
    expect(overlay().querySelector('ul')).toBeNull();
    expect(dialogButton(`${K}.showChanges`)).toBeDefined();
  });

  it('shows 200 files, and says how many more there are', async () => {
    await open(Array.from({ length: 5000 }, (_, index) => `file-${index}.md`));

    expect(rows()).toHaveLength(200);
    expect(overlay().textContent).toContain('and 4800 more');
  });

  it('does not say more when all are shown', async () => {
    await open(Array.from({ length: 200 }, (_, index) => `file-${index}.md`));

    expect(rows()).toHaveLength(200);
    expect(overlay().textContent).not.toContain(`more`);
  });

  it('has the focus on Show changes, which closes with true', async () => {
    await open([ 'README.md' ]);
    const closed = firstValueFrom(ref.closed);

    expect(document.activeElement).toBe(dialogButton(`${K}.showChanges`));

    dialogButton(`${K}.showChanges`)?.click();

    expect(await closed).toBe(true);
  });

  it('Close closes without opening Changes', async () => {
    await open([ 'README.md' ]);
    const closed = firstValueFrom(ref.closed);

    dialogButton(`${K}.close`)?.click();

    expect(await closed).toBe(false);
  });
});
