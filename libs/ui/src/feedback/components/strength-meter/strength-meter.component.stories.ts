import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen } from 'storybook/test';

import { StrengthMeterComponent } from './strength-meter.component';

const meta: Meta<StrengthMeterComponent> = {
  title: 'Feedback/Strength meter',
  component: StrengthMeterComponent
};

export default meta;

type Story = StoryObj<StrengthMeterComponent>;

const TEXTS = [ 'Weak', 'Weak', 'Fair', 'Good', 'Strong' ];

/** Before the user has typed anything. */
export const Empty: Story = {
  render: () => ({
    template: `<ui-strength-meter label="Password strength" [score]="null" valueText="No password yet" />`
  }),
  play: async () => {
    await expect(screen.getByRole('meter', { name: 'Password strength' })).toHaveAttribute(
      'aria-valuetext',
      'No password yet'
    );
  }
};

/** Every score, from 0 to 4 (PP-14). */
export const Scores: Story = {
  render: () => ({
    props: { scores: [ 0, 1, 2, 3, 4 ], texts: TEXTS },
    styles: [ '.list { display: grid; gap: 1rem; max-inline-size: 24rem; }' ],
    template: `
      <div class="list">
        @for (score of scores; track score) {
          <ui-strength-meter label="Password strength" [score]="score" [valueText]="texts[score]" />
        }
      </div>
    `
  }),
  play: async () => {
    const meters = screen.getAllByRole('meter', { name: 'Password strength' });
    await expect(meters).toHaveLength(5);
    await expect(meters[4]).toHaveAttribute('aria-valuetext', 'Strong');
  }
};

/** On the smallest supported screen (NF-12.4). */
export const Narrow: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `<div class="narrow"><ui-strength-meter label="Password strength" [score]="3" valueText="Good" /></div>`
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};
