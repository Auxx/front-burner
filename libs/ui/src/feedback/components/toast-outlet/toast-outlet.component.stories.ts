import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { type ToastOptions } from '../../services/toast/toast.model';
import { TOAST_DURATION_MS, ToastService } from '../../services/toast/toast.service';
import { ToastOutletComponent } from './toast-outlet.component';

/** A button per toast, as the results of a feature's actions, and the outlet. */
@Component({
  selector: 'ui-toast-demo',
  imports: [ ButtonComponent, ToastOutletComponent ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ '.row { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); }' ],
  template: `
    <div class="row">
      @for (toast of toasts(); track $index) {
        <button uiButton (click)="show(toast)">{{ toast.message }}</button>
      }
    </div>
    <ui-toast-outlet label="Notifications" />
  `
})
class ToastDemoComponent {
  readonly toasts = input.required<readonly ToastOptions[]>();

  private readonly service = inject(ToastService);

  protected show(toast: ToastOptions): void {
    this.service.show(toast);
  }
}

const meta: Meta<ToastOutletComponent> = {
  title: 'Feedback/Toast',
  component: ToastOutletComponent,
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ ToastDemoComponent ] } }) ]
};

export default meta;

type Story = StoryObj<ToastOutletComponent>;

const dismissLabel = 'Dismiss';
const noop = () => undefined;

const gitResults: readonly ToastOptions[] = [
  { message: 'Already up to date', dismissLabel },
  { message: 'Pulled 3 commits', status: 'success', dismissLabel },
  { message: 'Pushed 2 commits to origin/main', status: 'success', dismissLabel },
  {
    message: 'The remote has new commits. Pull first.',
    status: 'warning',
    dismissLabel,
    actions: [ { label: 'Pull', run: noop } ]
  }
];

/** The results of pull and push (GA-28, GA-30, GA-32). */
export const GitResults: Story = {
  render: () => ({ props: { gitResults }, template: `<ui-toast-demo [toasts]="gitResults" />` })
};

const merge: readonly ToastOptions[] = [ {
  message: 'Merge committed. Push to publish it.',
  status: 'success',
  dismissLabel,
  actions: [ { label: 'Push', run: noop }, { label: 'Undo merge', run: noop } ]
} ];

/** A toast with actions stays until it is dismissed (GC-22, WCAG 2.2.1). */
export const MergeCommitted: Story = {
  render: () => ({ props: { merge }, template: `<ui-toast-demo [toasts]="merge" />` }),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: merge[0].message }));

    await new Promise(resolve => setTimeout(resolve, TOAST_DURATION_MS + 500));

    await expect(screen.getByRole('region', { name: 'Notifications' })).toHaveTextContent(merge[0].message);
  }
};

const updated: readonly ToastOptions[] = [ { message: 'This file was updated.', key: 'file-updated', dismissLabel } ];

/** The same notice three times shows one toast (ED-24). */
export const FileUpdated: Story = {
  render: () => ({ props: { updated }, template: `<ui-toast-demo [toasts]="updated" />` }),
  play: async () => {
    const button = screen.getByRole('button', { name: updated[0].message });
    for (let n = 0; n < 3; n++) {
      await userEvent.click(button);
    }

    await expect(screen.getByRole('region', { name: 'Notifications' }).querySelectorAll('li')).toHaveLength(1);
  }
};

const long: readonly ToastOptions[] = [
  {
    message: 'Pushed 12 commits to origin/feature/a-branch-name-long-enough-to-wrap-on-a-phone',
    status: 'success',
    dismissLabel
  },
  {
    message: 'The remote rejected the push: the branch is protected and needs a pull request.',
    status: 'danger',
    dismissLabel,
    actions: [ { label: 'Show details', run: noop } ]
  }
];

/** Two long toasts on a phone (NF-12.4). */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => ({ props: { long }, template: `<ui-toast-demo [toasts]="long" />` }),
  play: async () => {
    for (const toast of long) {
      await userEvent.click(screen.getByRole('button', { name: toast.message }));
    }

    await expect(screen.getByRole('region', { name: 'Notifications' }).querySelectorAll('li')).toHaveLength(2);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  }
};
