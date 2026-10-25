import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { DialogFooterComponent } from '../../components/dialog-footer/dialog-footer.component';
import { DialogComponent } from '../../components/dialog/dialog.component';
import { DialogRef } from './dialog-ref';
import { DIALOG_DATA } from './dialog.model';
import { DialogService } from './dialog.service';

@Component({
  imports: [ ButtonComponent, DialogComponent, DialogFooterComponent ],
  template: `
    <ui-dialog heading="Unlock work-laptop" closeLabel="Close">
      <label>Passphrase <input type="password" /></label>
      <div uiDialogFooter>
        <button uiButton (click)="ref.close()">Cancel</button>
        <button uiButton variant="primary" (click)="ref.close(data.answer)">Unlock</button>
      </div>
    </ui-dialog>
  `
})
class UnlockDialogComponent {
  readonly ref = inject<DialogRef<string>>(DialogRef);
  readonly data = inject(DIALOG_DATA) as { answer: string; };
}

@Component({
  imports: [ DialogComponent ],
  template: `<ui-dialog heading="About"><p>Front Burner 1.0</p></ui-dialog>`
})
class TextDialogComponent {}

@Component({
  template: `<button>Open</button>`
})
class HostComponent {}

describe('DialogService', () => {
  let fixture: ComponentFixture<HostComponent>;
  let service: DialogService;

  const opener = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
  const button = (text: string) =>
    [ ...document.querySelectorAll('.cdk-overlay-container button') ].find(
      element => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === text
    ) as HTMLButtonElement;
  const stable = () => fixture.whenStable();
  const escape = () =>
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

  const openUnlock = async (answer = 'ok') => {
    opener().focus();
    const ref = service.open<UnlockDialogComponent, { answer: string; }, string>(UnlockDialogComponent, {
      data: { answer }
    });
    const results: (string | undefined)[] = [];
    let completed = false;
    ref.closed.subscribe({ next: result => results.push(result), complete: () => (completed = true) });
    await stable();
    return { ref, results, isCompleted: () => completed };
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    service = TestBed.inject(DialogService);
    await stable();
  });

  afterEach(async () => {
    TestBed.inject(DialogService).closeAll();
    await stable();
  });

  it('is a modal dialog named by its heading', async () => {
    await openUnlock();

    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    const heading = document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? '');
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe('Unlock work-laptop');
  });

  it('passes data in and a result out', async () => {
    const { results, isCompleted } = await openUnlock('ok');

    button('Unlock').click();
    await stable();

    expect(results).toEqual([ 'ok' ]);
    expect(isCompleted()).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('focuses its first field', async () => {
    await openUnlock();

    expect(document.activeElement).toBe(document.querySelector('.cdk-overlay-container input'));
  });

  it('closes on Escape and the close button with no result, and returns the focus', async () => {
    let opened = await openUnlock();
    escape();
    await stable();

    expect(opened.results).toEqual([ undefined ]);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());

    opened = await openUnlock();
    button('Close').click();
    await stable();

    expect(opened.results).toEqual([ undefined ]);
    expect(document.activeElement).toBe(opener());
  });

  it('does not close from the backdrop', async () => {
    await openUnlock();

    (document.querySelector('.ui-dialog-backdrop') as HTMLElement).click();
    await stable();

    expect(dialog()).not.toBeNull();
  });

  it('cannot be dismissed while not dismissible', async () => {
    const { ref, results } = await openUnlock();
    ref.dismissible.set(false);
    await stable();

    escape();
    await stable();
    expect(dialog()).not.toBeNull();
    expect(button('Close').disabled).toBe(true);

    ref.close('x');
    await stable();
    expect(results).toEqual([ 'x' ]);
  });

  it('asks for confirmation', async () => {
    const options = {
      heading: 'Remove handbook?',
      message: 'This deletes its working copy on Front Burner. The remote is not changed.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      variant: 'danger' as const
    };

    const first = service.confirm(options);
    await stable();

    expect(document.activeElement).toBe(button('Cancel'));
    expect(button('Remove').dataset['variant']).toBe('danger');
    expect(dialog()?.textContent).toContain(options.message);

    button('Remove').click();
    await stable();
    await expect(first).resolves.toBe(true);

    const second = service.confirm(options);
    await stable();
    escape();
    await stable();
    await expect(second).resolves.toBe(false);
  });

  it('focuses the dialog when it holds no field', async () => {
    service.open(TextDialogComponent);
    await stable();

    expect(document.activeElement).toBe(dialog());
  });
});
