import { signal } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { SelectOptionDirective } from '../../directives/select-option/select-option.directive';
import { type ChoiceOption } from '../../models/choice-option.model';
import { FieldComponent } from '../field/field.component';
import { SelectComponent } from './select.component';

const levels: readonly ChoiceOption<string>[] = [
  { value: 'simple', label: 'Simple', description: 'Git is hidden. Changes are saved and synchronised for you.' },
  { value: 'guided', label: 'Guided', description: 'Git in plain language, with help for conflicts.' },
  { value: 'advanced', label: 'Advanced', description: 'Full control over branches, commits and sync.' }
];

interface Key {
  readonly name: string;
  readonly type: string;
  readonly fingerprint: string;
  readonly passphrase: boolean;
}

const keys: readonly Key[] = [
  {
    name: 'Laptop',
    type: 'ED25519',
    fingerprint: 'SHA256:9xQm2b7Lk4TzR1vY8pWc3NfHs6JdA0gEuKiOl5MnBqZ',
    passphrase: false
  },
  {
    name: 'Work deploy key',
    type: 'ED25519',
    fingerprint: 'SHA256:Ht3Vr8Kp1QwZ6sLm9YbN2cXa7DfGj4Ue0IoRk5TzWvE',
    passphrase: true
  },
  {
    name: 'Old RSA key',
    type: 'RSA 4096',
    fingerprint: 'SHA256:Pq7Wn2Zr5Lx9Ka1Vt6Yb3Ms8Hd0Gf4Cj2Ue7Io5RkQzE',
    passphrase: false
  }
];

const meta: Meta<SelectComponent<string>> = {
  title: 'Controls/Select',
  component: SelectComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: { imports: [ IconComponent, FieldComponent, SelectOptionDirective ] }
    })
  ]
};

export default meta;

type Story = StoryObj<SelectComponent<string>>;

const width = '.form { max-inline-size: 24rem; }';

/** The git control level, with a description for each (AR-38). */
export const GitControlLevel: Story = {
  render: () => ({
    props: { levels, value: 'advanced' },
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Git control level">
          <ui-select [options]="levels" [(value)]="value" />
        </ui-field>
      </div>
    `
  }),
  play: async () => {
    const trigger = screen.getByRole('combobox', { name: 'Git control level' });

    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeVisible());
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');

    await expect(trigger).toHaveTextContent('Guided');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
};

/** Saved SSH keys with their type and fingerprint (AR-24) on a narrow screen. */
export const SavedKeys: Story = {
  render: () => ({
    props: {
      keys,
      options: keys.map(key => ({ value: key.name, label: key.name })),
      key: (name: string) => keys.find(key => key.name === name),
      value: 'Work deploy key'
    },
    styles: [
      '.narrow { inline-size: 20rem; }',
      '.key { display: flex; flex-direction: column; min-inline-size: 0; }',
      '.details { color: var(--ui-text-muted); font-size: var(--ui-font-size-ui-small); overflow-wrap: anywhere; }',
      '.passphrase { display: inline-flex; align-items: center; gap: var(--ui-space-1); }'
    ],
    template: `
      <div class="narrow">
        <ui-field label="Saved key">
          <ui-select [options]="options" [(value)]="value">
            <ng-template uiSelectOption let-option>
              <span class="key">
                <span>{{ option.label }}</span>
                <code class="details">{{ key(option.value)?.type }} {{ key(option.value)?.fingerprint }}</code>
                @if (key(option.value)?.passphrase) {
                  <span class="details passphrase">
                    <ui-icon name="lock" />
                    Passphrase
                  </span>
                }
              </span>
            </ng-template>
          </ui-select>
        </ui-field>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(screen.getByRole('combobox', { name: 'Saved key' }));
    const listbox = await waitFor(() => screen.getByRole('listbox'));

    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
    await expect(listbox.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  }
};

const branches: readonly ChoiceOption<string>[] = [
  'main',
  ...Array.from({ length: 39 }, (_, index) => `feature/topic-${String(index + 1).padStart(2, '0')}`)
].map(name => ({ value: name, label: name }));

/** A branch list loaded from an access check (AR-35). */
export const Branches: Story = {
  render: () => {
    const options = signal<readonly ChoiceOption<string>[]>([]);
    setTimeout(() => options.set(branches), 300);
    return {
      props: { options, value: 'main' },
      styles: [ width ],
      template: `
        <div class="form">
          <ui-field label="Branch">
            <ui-select [options]="options()" [(value)]="value" placeholder="Loading branches…" [disabled]="options().length === 0" />
          </ui-field>
        </div>
      `
    };
  },
  play: async () => {
    const trigger = screen.getByRole('combobox', { name: 'Branch' });

    await waitFor(() => expect(trigger).toHaveTextContent('main'));
  }
};

/** An error from the field. */
export const Invalid: Story = {
  render: () => ({
    props: { levels },
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Git control level" error="Choose a level">
          <ui-select [options]="levels" placeholder="Choose a level" />
        </ui-field>
      </div>
    `
  })
};

/** A disabled select. */
export const Disabled: Story = {
  render: () => ({
    props: { levels, value: 'advanced' },
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Git control level">
          <ui-select [options]="levels" [value]="value" disabled />
        </ui-field>
      </div>
    `
  })
};

/** A click on a disabled option keeps the focus on the trigger, so Escape closes the list. */
export const DisabledOption: Story = {
  render: () => ({
    props: {
      options: levels.map(level => ({ ...level, disabled: level.value === 'guided' })),
      value: 'advanced'
    },
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Git control level">
          <ui-select [options]="options" [(value)]="value" />
        </ui-field>
      </div>
    `
  }),
  play: async () => {
    const trigger = screen.getByRole('combobox', { name: 'Git control level' });

    await userEvent.click(trigger);
    await userEvent.click(await waitFor(() => screen.getByRole('option', { name: /Guided/ })));
    await expect(trigger).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveTextContent('Advanced');

    await userEvent.click(trigger);
    await userEvent.click(await waitFor(() => screen.getByRole('option', { name: /Simple/ })));
    await expect(trigger).toHaveTextContent('Simple');
  }
};
