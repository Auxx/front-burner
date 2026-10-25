import { signal } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { SelectOptionDirective } from '../../directives/select-option/select-option.directive';
import { type ChoiceOption } from '../../models/choice-option.model';
import { FieldComponent } from '../field/field.component';
import { SelectComponent } from './select.component';

// Codicon `lock` (CC-BY-4.0), inline until the Icon component exists.
const lock =
  'M8 9C8.55228 9 9 9.44771 9 10C9 10.5523 8.55228 11 8 11C7.44772 11 7 10.5523 7 10C7 9.44771 7.44772 9 8 9Z M8 1C9.654 1 11 2.346 11 4V6H12C13.103 6 14 6.897 14 8V13C14 14.103 13.103 15 12 15H4C2.897 15 2 14.103 2 13V8C2 6.897 2.897 6 4 6H5V4C5 2.346 6.346 1 8 1ZM4 7C3.449 7 3 7.449 3 8V13C3 13.551 3.449 14 4 14H12C12.551 14 13 13.551 13 13V8C13 7.449 12.551 7 12 7H4ZM8 2C6.897 2 6 2.897 6 4V6H10V4C10 2.897 9.103 2 8 2Z';

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
      moduleMetadata: { imports: [ FieldComponent, SelectOptionDirective ] }
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
      lock,
      options: keys.map(key => ({ value: key.name, label: key.name })),
      key: (name: string) => keys.find(key => key.name === name),
      value: 'Work deploy key'
    },
    styles: [
      '.narrow { inline-size: 20rem; }',
      '.key { display: flex; flex-direction: column; min-inline-size: 0; }',
      '.details { color: var(--ui-text-muted); font-size: var(--ui-font-size-ui-small); overflow-wrap: anywhere; }',
      '.passphrase { display: inline-flex; align-items: center; gap: var(--ui-space-1); }',
      'svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }'
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
                    <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="lock" /></svg>
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
