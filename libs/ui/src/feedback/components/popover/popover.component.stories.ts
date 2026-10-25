import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { PopoverTriggerDirective } from '../../directives/popover-trigger/popover-trigger.directive';
import { PopoverComponent } from './popover.component';

const meta: Meta<PopoverComponent> = {
  title: 'Feedback/Popover',
  component: PopoverComponent,
  decorators: [
    story => ({ ...story(), moduleMetadata: { imports: [ ButtonComponent, PopoverTriggerDirective ] } })
  ]
};

export default meta;

type Story = StoryObj<PopoverComponent>;

const content = 'p { margin: 0 0 var(--ui-space-2); }';

/** Why a background fetch failed, with Try again (GA-35). */
export const RemoteCheckFailed: Story = {
  render: () => ({
    styles: [ content ],
    template: `
      <button uiButton variant="ghost" size="small" [uiPopoverTrigger]="info">Couldn't check for remote changes</button>
      <ui-popover #info="uiPopover" label="Remote check failed">
        <p>The server did not answer within 30 seconds.</p>
        <button uiButton size="small">Try again</button>
      </ui-popover>
    `
  }),
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'Couldn\'t check for remote changes' });

    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus());

    await userEvent.keyboard('{Escape}');

    await expect(trigger).toHaveFocus();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
};

/** A trigger at the right edge of a phone screen with long text (NF-12.4). */
export const Narrow: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => ({
    styles: [ content, '.edge { display: flex; justify-content: flex-end; }' ],
    template: `
      <div class="edge">
        <button uiButton size="small" [uiPopoverTrigger]="info">Details</button>
      </div>
      <ui-popover #info="uiPopover" label="Details">
        <p>
          The remote rejected the push: remote: error: GH006: Protected branch update failed for
          refs/heads/main. remote: error: Changes must be made through a pull request.
        </p>
      </ui-popover>
    `
  }),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));

    const popover = await screen.findByRole('dialog', { name: 'Details' });
    await waitFor(() => expect(popover).toHaveFocus());
    const rect = popover.getBoundingClientRect();
    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  }
};
