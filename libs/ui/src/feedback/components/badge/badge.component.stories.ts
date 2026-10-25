import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { BadgeComponent } from './badge.component';

const meta: Meta<BadgeComponent> = {
  title: 'Feedback/Badge',
  component: BadgeComponent,
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ IconComponent ] } }) ]
};

export default meta;

type Story = StoryObj<BadgeComponent>;

/** Repository statuses and warnings (DS-22, RM-6, RM-8). */
export const Statuses: Story = {
  render: () => ({
    styles: [
      '.row { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); }'
    ],
    template: `
      <div class="row">
        <span uiBadge>
          <ui-icon name="sync" />
          Cloning
        </span>
        <span uiBadge status="danger">Clone failed</span>
        <span uiBadge status="warning">Credentials refused</span>
        <span uiBadge status="success">Up to date</span>
        <span uiBadge status="info">Needs your confirmation</span>
      </div>
    `
  })
};

/** A long label in a narrow column. */
export const Long: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 12rem; }' ],
    template: `<div class="narrow"><span uiBadge status="danger">Working copy is missing or damaged</span></div>`
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};
