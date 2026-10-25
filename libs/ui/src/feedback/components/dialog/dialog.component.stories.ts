import { ChangeDetectionStrategy, Component, inject, input, signal, type Type } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { KeyValueListComponent } from '../../../content/components/key-value-list/key-value-list.component';
import { KeyValueComponent } from '../../../content/components/key-value/key-value.component';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { CheckboxComponent } from '../../../controls/components/checkbox/checkbox.component';
import { ChoiceComponent } from '../../../controls/components/choice/choice.component';
import { FieldComponent } from '../../../controls/components/field/field.component';
import { InputComponent } from '../../../controls/components/input/input.component';
import { DialogRef } from '../../services/dialog/dialog-ref';
import { DialogService } from '../../services/dialog/dialog.service';
import { DialogFooterComponent } from '../dialog-footer/dialog-footer.component';
import { DialogComponent } from './dialog.component';

const dialogImports = [ ButtonComponent, DialogComponent, DialogFooterComponent ];

/** RC-16: unlock a passphrase-protected key. */
@Component({
  selector: 'ui-unlock-key-dialog',
  imports: [ ...dialogImports, FieldComponent, InputComponent ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ 'dl { display: grid; grid-template-columns: auto 1fr; gap: var(--ui-space-1) var(--ui-space-3); }' ],
  template: `
    <ui-dialog heading="Unlock work-laptop" closeLabel="Close">
      <dl>
        <dt>Type</dt><dd>ED25519</dd>
        <dt>Fingerprint</dt><dd>SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU</dd>
      </dl>
      <ui-field label="Passphrase" [error]="error()">
        <input uiInput type="password" />
      </ui-field>
      <div uiDialogFooter>
        <button uiButton [disabled]="busy()" (click)="ref.close()">Cancel</button>
        <button uiButton variant="primary" [busy]="busy()" (click)="unlock()">Unlock</button>
      </div>
    </ui-dialog>
  `
})
class UnlockKeyDialogComponent {
  protected readonly ref = inject(DialogRef);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | undefined>(undefined);

  protected unlock(): void {
    this.busy.set(true);
    this.ref.dismissible.set(false);
    setTimeout(() => {
      this.busy.set(false);
      this.ref.dismissible.set(true);
      this.error.set('Wrong passphrase');
    }, 1000);
  }
}

/** RC-21, RC-22: the server's host key changed. */
@Component({
  selector: 'ui-changed-host-key-dialog',
  imports: [ ...dialogImports, CheckboxComponent, ChoiceComponent, KeyValueComponent, KeyValueListComponent ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-dialog heading="The server's identity has changed" closeLabel="Close">
      <p>This may be an attack. It also happens when a provider replaces its keys.</p>
      <dl uiKeyValueList>
        <div uiKeyValue label="Host">github.com, port 22</div>
        <div uiKeyValue label="Trusted key" mono>ED25519 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU</div>
        <div uiKeyValue label="New key" mono>ED25519 SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM</div>
      </dl>
      <label uiChoice>
        <input type="checkbox" uiCheckbox (change)="checked.set($any($event.target).checked)" />
        I have checked the new fingerprint with the server's owner.
      </label>
      <div uiDialogFooter>
        <button uiButton (click)="ref.close()">Cancel</button>
        <button uiButton variant="danger" [disabled]="!checked()" (click)="ref.close(true)">Trust the new key</button>
      </div>
    </ui-dialog>
  `
})
class ChangedHostKeyDialogComponent {
  protected readonly ref = inject(DialogRef);
  protected readonly checked = signal(false);
}

/** A dialog taller than the screen. */
@Component({
  selector: 'ui-tall-dialog',
  imports: dialogImports,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-dialog heading="Remote messages">
      @for (line of lines; track line) {
        <p>remote: line {{ line }} of the server's answer</p>
      }
      <div uiDialogFooter><button uiButton (click)="ref.close()">Close</button></div>
    </ui-dialog>
  `
})
class TallDialogComponent {
  protected readonly ref = inject(DialogRef);
  protected readonly lines = Array.from({ length: 60 }, (_, index) => index + 1);
}

/** Opens one of the dialogs above, or a confirmation, as a feature would. */
@Component({
  selector: 'ui-dialog-opener',
  imports: [ ButtonComponent ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button uiButton (click)="open()">Open</button><p>Result: {{ result() }}</p>`
})
class DialogOpenerComponent {
  readonly dialog = input<'unlock' | 'host-key' | 'tall' | 'confirm'>('unlock');
  /** The repository that the confirmation removes. */
  readonly repository = input('handbook');
  protected readonly result = signal('');

  private readonly dialogs = inject(DialogService);
  private readonly components: Record<'unlock' | 'host-key' | 'tall', Type<unknown>> = {
    unlock: UnlockKeyDialogComponent,
    'host-key': ChangedHostKeyDialogComponent,
    tall: TallDialogComponent
  };

  protected async open(): Promise<void> {
    const kind = this.dialog();
    if (kind === 'confirm') {
      const confirmed = await this.dialogs.confirm({
        heading: `Remove ${this.repository()}?`,
        message: 'This deletes its working copy on Front Burner. The remote is not changed.',
        confirmLabel: 'Remove',
        cancelLabel: 'Cancel',
        variant: 'danger'
      });
      this.result.set(String(confirmed));
      return;
    }
    this.dialogs.open(this.components[kind]).closed.subscribe(value => this.result.set(String(value)));
  }
}

const meta: Meta<DialogComponent> = {
  title: 'Feedback/Dialog',
  component: DialogComponent,
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ DialogOpenerComponent ] } }) ]
};

export default meta;

type Story = StoryObj<DialogComponent>;

const openDialog = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  return await screen.findByRole('dialog');
};

/** Unlock a key: the focus starts in the passphrase field (RC-16, RC-25). */
export const UnlockKey: Story = {
  render: () => ({ template: `<ui-dialog-opener [dialog]="'unlock'" />` }),
  play: async () => {
    const dialog = await openDialog();

    await waitFor(() => expect(dialog.querySelector('input')).toHaveFocus());
    const close = screen.getByRole('button', { name: 'Close' });
    await expect((close.querySelector('svg') as SVGElement).getBoundingClientRect().width).toBeGreaterThan(0);
  }
};

/** A changed host key on a phone: each fingerprint sits under its label and wraps (RC-21, NF-12.4). */
export const ChangedHostKey: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => ({ template: `<ui-dialog-opener [dialog]="'host-key'" />` }),
  play: async () => {
    const dialog = await openDialog();
    const rect = dialog.getBoundingClientRect();

    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const item of dialog.querySelectorAll('[uiKeyValue]')) {
      const dt = (item.querySelector('dt') as HTMLElement).getBoundingClientRect();
      const value = item.querySelector('dd') as HTMLElement;
      await expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
      await expect(value.getBoundingClientRect().top).toBeGreaterThanOrEqual(dt.bottom);
    }
  }
};

/** A tall dialog scrolls its content; its footer stays on the screen. */
export const TallContent: Story = {
  render: () => ({ template: `<ui-dialog-opener [dialog]="'tall'" />` }),
  play: async () => {
    const dialog = await openDialog();
    const body = dialog.querySelector('.body') as HTMLElement;
    const footer = dialog.querySelector('.footer') as HTMLElement;

    await expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  }
};

/** A confirmation focuses Cancel; Escape returns the focus to the opener (RM-17). */
export const ConfirmRemove: Story = {
  render: () => ({ template: `<ui-dialog-opener [dialog]="'confirm'" />` }),
  play: async () => {
    await openDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
    await expect(screen.getByText('Result: false')).toBeVisible();
  }
};

/** A repository name with no break points wraps in the heading on a phone (RM-17, NF-12.4). */
export const RemoveLongName: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => ({
    template:
      `<ui-dialog-opener [dialog]="'confirm'" repository="TheEngineeringHandbookOfAnOrganisationWithAVeryLongRepositoryName" />`
  }),
  play: async () => {
    const dialog = await openDialog();
    const heading = within(dialog).getByRole('heading', { name: /^Remove TheEngineeringHandbook/ });

    await expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
    await expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  }
};
