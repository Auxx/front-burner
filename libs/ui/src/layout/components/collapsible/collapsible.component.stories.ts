import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { CollapsibleComponent } from './collapsible.component';

const meta: Meta<CollapsibleComponent> = {
  title: 'Layout/Collapsible',
  component: CollapsibleComponent,
  render: props => ({
    props,
    moduleMetadata: { imports: [ ButtonComponent ] },
    template: `
      <button uiButton variant="ghost" size="small" type="button" aria-controls="details"
        [attr.aria-expanded]="open" (click)="open = !open">Details</button>
      <ui-collapsible id="details" [open]="open">
        <ul>
          <li><code>&lt;iframe&gt;</code> × 2</li>
          <li><code>style</code> attribute × 5</li>
        </ul>
      </ui-collapsible>
      <p>Text below the region moves down as it opens.</p>
    `
  })
};

export default meta;

type Story = StoryObj<CollapsibleComponent>;

/** Closed: the content is in the document, inert and hidden. */
export const Closed: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const region = canvasElement.querySelector('#details') as HTMLElement;
    await expect(region).toHaveAttribute('inert');
    await waitFor(() => expect(getComputedStyle(region).visibility).toBe('hidden'));
  }
};

/** Open, after a click on the button. */
export const Opened: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Details' }));
    const region = canvasElement.querySelector('#details') as HTMLElement;
    await waitFor(() => expect(region).not.toHaveAttribute('inert'));
    await waitFor(() => expect(region.getBoundingClientRect().height).toBeGreaterThan(20));
  }
};
