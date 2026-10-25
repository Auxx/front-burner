import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { type ChoiceOption } from '../../models/choice-option.model';
import { SegmentedControlComponent } from './segmented-control.component';

const credentials: readonly ChoiceOption<string>[] = [
  { value: 'saved', label: 'Use saved credentials' },
  { value: 'new', label: 'Add new credentials' },
  { value: 'none', label: 'No credentials (public repository)' }
];

const cloneModes: readonly ChoiceOption<string>[] = [
  { value: 'full', label: 'Full clone', description: 'All branches and history' },
  {
    value: 'single',
    label: 'Single branch',
    description: 'One branch, latest commit only. Faster, but limits the git workflow.'
  }
];

const meta: Meta<SegmentedControlComponent<string>> = {
  title: 'Controls/Segmented control',
  component: SegmentedControlComponent
};

export default meta;

type Story = StoryObj<SegmentedControlComponent<string>>;

/** The credentials choices of an HTTPS remote (AR-19). */
export const Credentials: Story = {
  render: () => ({
    props: { credentials, value: 'saved' },
    template: `<ui-segmented-control label="Credentials" [options]="credentials" [(value)]="value" />`
  }),
  play: async () => {
    await userEvent.click(screen.getByRole('radio', { name: 'Add new credentials' }));
    await userEvent.keyboard('{ArrowRight}');

    await expect(screen.getByRole('radio', { name: 'No credentials (public repository)' })).toBeChecked();
  }
};

/** The same on the smallest supported screen: labels wrap (NF-12.4). */
export const Narrow: Story = {
  render: () => ({
    props: { credentials, value: 'saved' },
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <ui-segmented-control label="Credentials" [options]="credentials" [(value)]="value" />
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);

    for (const segment of canvasElement.querySelectorAll<HTMLElement>('.segment')) {
      await expect(segment.scrollWidth).toBeLessThanOrEqual(segment.clientWidth);
    }
  }
};

/** The clone mode, with the chosen mode's description below it (AR-33). */
export const CloneMode: Story = {
  render: () => ({
    props: {
      cloneModes,
      value: 'full',
      description: (value: string) => cloneModes.find(mode => mode.value === value)?.description
    },
    styles: [ 'p { margin-block-start: var(--ui-space-1); color: var(--ui-text-muted); }' ],
    template: `
      <ui-segmented-control label="Clone mode" [options]="cloneModes" [(value)]="value" aria-describedby="clone-mode-description" />
      <p id="clone-mode-description">{{ description(value) }}</p>
    `
  })
};

/** A disabled control. */
export const Disabled: Story = {
  render: () => ({
    props: { credentials, value: 'new' },
    template: `<ui-segmented-control label="Credentials" [options]="credentials" [value]="value" disabled />`
  })
};
