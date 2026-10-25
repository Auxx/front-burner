import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen } from 'storybook/test';

import { ProgressBarComponent } from './progress-bar.component';

const meta: Meta<ProgressBarComponent> = {
  title: 'Feedback/Progress bar',
  component: ProgressBarComponent
};

export default meta;

type Story = StoryObj<ProgressBarComponent>;

/** A clone's progress, filling up over 3 s (RM-7). */
export const Clone: Story = {
  render: () => {
    const props = { value: 0, text: () => `Receiving objects: ${props.value} %` };
    const timer = setInterval(() => {
      props.value = Math.min(props.value + 5, 100);
      if (props.value === 100) {
        clearInterval(timer);
      }
    }, 150);
    return {
      props,
      template: `<ui-progress-bar label="Cloning handbook" [value]="value" [valueText]="text()" />`
    };
  },
  play: async () => {
    await expect(screen.getByRole('progressbar', { name: 'Cloning handbook' })).toHaveAttribute('aria-valuenow');
  }
};

/** Waiting its turn, with no value yet (AR-52). */
export const Indeterminate: Story = {
  render: () => ({
    template: `<ui-progress-bar label="Waiting for other clones to finish" />`
  })
};

/** On the smallest supported screen (NF-12.4). */
export const Narrow: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `<div class="narrow"><ui-progress-bar label="Cloning handbook" [value]="45" /></div>`
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};
