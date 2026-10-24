import { Meta, StoryObj } from '@storybook/angular';
import { expect, waitFor } from 'storybook/test';
import { TokenOverviewComponent } from './token-overview.component';

const meta: Meta<TokenOverviewComponent> = {
  title: 'Design system/Tokens',
  component: TokenOverviewComponent,
  parameters: {
    layout: 'fullscreen'
  },
  render: props => ({
    props,
    template: `<ui-token-overview [section]="section"></ui-token-overview>`
  })
};

export default meta;

type Story = StoryObj<TokenOverviewComponent>;

export const Primitives: Story = {
  args: { section: 'primitives' }
};

export const Colours: Story = {
  args: { section: 'colours' }
};

/** Fails in the test-runner when any pair is below its minimum in either scheme (A-10.10). */
export const Contrast: Story = {
  args: { section: 'contrast' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('tr[data-status]').length).toBeGreaterThan(0));

    const failing = Array.from(canvasElement.querySelectorAll('tr[data-status]:not([data-status="pass"])')).map(row =>
      row.textContent?.replace(/\s+/g, ' ').trim()
    );
    await expect(failing).toEqual([]);
  }
};

export const Typography: Story = {
  args: { section: 'typography' }
};

export const SpaceShapeAndMotion: Story = {
  name: 'Space, shape and motion',
  args: { section: 'layout' }
};
