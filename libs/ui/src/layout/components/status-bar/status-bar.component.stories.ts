import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';
import { StatusBarComponent } from './status-bar.component';

const meta: Meta<StatusBarComponent> = {
  title: 'Layout/Status bar',
  component: StatusBarComponent,
  parameters: {
    layout: 'fullscreen'
  },
  args: { label: 'Status' },
  render: props => ({
    props,
    template: `
      <ui-status-bar [label]="label">
        main · 2 to push · 1 to pull
        <span uiStatusBarEnd>Saved</span>
      </ui-status-bar>
    `
  })
};

export default meta;

type Story = StoryObj<StatusBarComponent>;

export const Default: Story = {};

/** A long branch name on the smallest supported screen (NF-12.4). */
export const LongText: Story = {
  render: props => ({
    props,
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <ui-status-bar [label]="label">
          feature/a-very-long-branch-name-that-does-not-fit · 12 to push
          <span uiStatusBarEnd>Saving…</span>
        </ui-status-bar>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};

/** Long end content is shortened too, and leaves room for the start. */
export const LongEnd: Story = {
  render: props => ({
    props,
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <ui-status-bar [label]="label">
          main
          <span uiStatusBarEnd>Saving docs/a-very-long-folder-name/and-a-long-file-name.md…</span>
        </ui-status-bar>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    const statusBar = canvasElement.querySelector('ui-status-bar') as HTMLElement;
    const start = canvasElement.querySelector('ui-status-bar .start') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
    await expect(statusBar.scrollWidth).toBeLessThanOrEqual(statusBar.clientWidth);
    await expect(start.getBoundingClientRect().width).toBeGreaterThan(0);
  }
};
