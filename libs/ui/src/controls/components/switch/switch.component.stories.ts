import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { ChoiceComponent } from '../choice/choice.component';
import { SwitchComponent } from './switch.component';

const meta: Meta<SwitchComponent> = {
  title: 'Controls/Switch',
  component: SwitchComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: { imports: [ ChoiceComponent ] }
    })
  ]
};

export default meta;

type Story = StoryObj<SwitchComponent>;

/** Off, on and disabled. */
export const States: Story = {
  render: () => ({
    styles: [ '.column { display: flex; flex-direction: column; align-items: start; }' ],
    template: `
      <div class="column">
        <label uiChoice><input type="checkbox" uiSwitch /> Hide non-Markdown files</label>
        <label uiChoice><input type="checkbox" uiSwitch checked /> Use the default author</label>
        <label uiChoice><input type="checkbox" uiSwitch disabled /> Disabled</label>
      </div>
    `
  })
};

/** The thumb moves to the inline end, which is the left in right-to-left. */
export const RightToLeft: Story = {
  render: () => ({
    template: `
      <div dir="rtl">
        <label uiChoice><input type="checkbox" uiSwitch /> Hide non-Markdown files</label>
      </div>
    `
  }),
  play: async () => {
    const input = screen.getByRole('switch', { name: 'Hide non-Markdown files' });

    await userEvent.click(input);

    // The thumb is positioned from the inline start, the right edge in
    // right-to-left; wait for its transition to end.
    await waitFor(async () => {
      const track = input.getBoundingClientRect();
      const thumb = getComputedStyle(input, '::after');
      const thumbLeft = track.right - parseFloat(thumb.right) - parseFloat(thumb.width);
      await expect(thumbLeft).toBeLessThan(track.left + track.width / 2);
    });
  }
};
