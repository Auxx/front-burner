import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';
import { DividerComponent } from './divider.component';

const meta: Meta<DividerComponent> = {
  title: 'Content/Divider',
  component: DividerComponent,
  decorators: [ story => ({ ...story(), styles: [ ':host { display: block; max-inline-size: 24rem; }' ] }) ]
};

export default meta;

type Story = StoryObj<DividerComponent>;

export const WithText: Story = {
  render: () => ({ template: '<ui-divider>or</ui-divider>' }),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('ui-divider .line')).toHaveLength(2);
  }
};

export const WithoutText: Story = {
  render: () => ({ template: '<ui-divider />' }),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('ui-divider .line')).toHaveLength(1);
  }
};
