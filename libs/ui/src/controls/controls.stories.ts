import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type FieldTree, form, FormField, pattern, required } from '@angular/forms/signals';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { ButtonComponent } from './components/button/button.component';
import { CheckboxComponent } from './components/checkbox/checkbox.component';
import { ChoiceComponent } from './components/choice/choice.component';
import { FieldComponent } from './components/field/field.component';
import { IconButtonComponent } from './components/icon-button/icon-button.component';
import { InputComponent } from './components/input/input.component';
import { SegmentedControlComponent } from './components/segmented-control/segmented-control.component';
import { SelectComponent } from './components/select/select.component';
import { PasswordRevealDirective } from './directives/password-reveal/password-reveal.directive';
import { type ChoiceOption } from './models/choice-option.model';

// Codicon `eye` (CC-BY-4.0), inline until the Icon component exists.
const eye =
  'M2.98444 8.62471L2.98346 8.62815C2.91251 8.8948 2.63879 9.05404 2.37202 8.9833C1.94098 8.86907 2.01687 8.37186 2.01687 8.37186L2.03453 8.31047C2.03453 8.31047 2.06063 8.22636 2.08166 8.1653C2.12369 8.04329 2.18795 7.87274 2.27931 7.66977C2.46154 7.26493 2.75443 6.72477 3.19877 6.18295C4.09629 5.08851 5.60509 4 8.00017 4C10.3952 4 11.904 5.08851 12.8016 6.18295C13.2459 6.72477 13.5388 7.26493 13.721 7.66977C13.8124 7.87274 13.8766 8.04329 13.9187 8.1653C13.9397 8.22636 13.9552 8.27541 13.9658 8.31047C13.9711 8.328 13.9752 8.34204 13.9781 8.35236L13.9816 8.365L13.9827 8.36916L13.9832 8.37069L13.9835 8.37186C14.0542 8.63878 13.8952 8.91253 13.6283 8.9833C13.3618 9.05397 13.0885 8.89556 13.0172 8.62937L13.0169 8.62815L13.0159 8.62471L13.0085 8.5997C13.0014 8.57616 12.9898 8.53927 12.9732 8.49095C12.9399 8.39422 12.8866 8.25227 12.8091 8.08023C12.6538 7.73508 12.4041 7.27523 12.0283 6.81706C11.2857 5.9115 10.0445 5 8.00017 5C5.95584 5 4.71464 5.9115 3.97201 6.81706C3.59627 7.27523 3.34655 7.73508 3.19119 8.08023C3.11375 8.25227 3.06047 8.39422 3.02715 8.49095C3.01051 8.53927 2.9989 8.57616 2.99179 8.5997L2.98444 8.62471ZM8.00024 7C6.61953 7 5.50024 8.11929 5.50024 9.5C5.50024 10.8807 6.61953 12 8.00024 12C9.38096 12 10.5002 10.8807 10.5002 9.5C10.5002 8.11929 9.38096 7 8.00024 7ZM6.50024 9.5C6.50024 8.67157 7.17182 8 8.00024 8C8.82867 8 9.50024 8.67157 9.50024 9.5C9.50024 10.3284 8.82867 11 8.00024 11C7.17182 11 6.50024 10.3284 6.50024 9.5Z';

const credentialsChoices: readonly ChoiceOption<string>[] = [
  { value: 'saved', label: 'Use saved credentials' },
  { value: 'new', label: 'Add new credentials' },
  { value: 'none', label: 'No credentials (public repository)' }
];

const savedCredentials: readonly ChoiceOption<string>[] = [
  { value: 'github', label: 'GitHub (octocat)' },
  { value: 'bitbucket', label: 'Bitbucket (octocat)' }
];

const levels: readonly ChoiceOption<string>[] = [
  { value: 'simple', label: 'Simple', description: 'Git is hidden. Changes are saved and synchronised for you.' },
  { value: 'guided', label: 'Guided', description: 'Git in plain language, with help for conflicts.' },
  { value: 'advanced', label: 'Advanced', description: 'Full control over branches, commits and sync.' }
];

/**
 * The Add repository form (AR-5) with Signal Forms, as a feature would build
 * it. It lives in a story, which the library build does not include, so `ui`
 * itself does not use `@angular/forms` (A-10.42).
 */
@Component({
  selector: 'ui-add-repository-form',
  imports: [
    ButtonComponent,
    CheckboxComponent,
    ChoiceComponent,
    FieldComponent,
    FormField,
    IconButtonComponent,
    InputComponent,
    PasswordRevealDirective,
    SegmentedControlComponent,
    SelectComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: var(--ui-space-3);
      max-inline-size: 32rem;
    }

    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ui-space-2);
    }

    svg {
      inline-size: var(--ui-icon-size);
      block-size: var(--ui-icon-size);
    }
  `,
  template: `
    <form (submit)="$event.preventDefault()">
      <ui-field label="Remote URL" hint="An HTTPS or SSH URL" [error]="error(model.url)">
        <input uiInput [formField]="model.url" />
      </ui-field>
      <ui-field label="Repository name" [error]="error(model.name)">
        <input uiInput [formField]="model.name" />
      </ui-field>
      <ui-segmented-control label="Credentials" [options]="credentialsChoices" [formField]="model.credentials" />
      @switch (model.credentials().value()) {
        @case ('saved') {
          <ui-field label="Saved credentials">
            <ui-select [options]="savedCredentials" [formField]="model.saved" />
          </ui-field>
        }
        @case ('new') {
          <ui-field label="Credentials name" [error]="error(model.credentialsName)">
            <input uiInput [formField]="model.credentialsName" />
          </ui-field>
          <ui-field label="Username" [error]="error(model.username)">
            <input uiInput [formField]="model.username" autocomplete="username" />
          </ui-field>
          <ui-field
            label="Password or token"
            hint="GitHub and Bitbucket need an access token, not your account password."
            [error]="error(model.password)"
          >
            <input uiInput #secret type="password" [formField]="model.password" autocomplete="current-password" />
            <button uiIconButton [uiPasswordReveal]="secret" label="Show password">
              <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="eye" /></svg>
            </button>
          </ui-field>
        }
      }
      <ui-field label="Git control level">
        <ui-select [options]="levels" [formField]="model.level" />
      </ui-field>
      <label uiChoice><input type="checkbox" uiCheckbox [formField]="model.understood" /> I understand</label>
      <div class="buttons">
        <button uiButton variant="primary" type="submit" [disabled]="model().invalid()">Add repository</button>
        <button uiButton>Cancel</button>
      </div>
    </form>
  `
})
class AddRepositoryFormComponent {
  protected readonly eye = eye;
  protected readonly credentialsChoices = credentialsChoices;
  protected readonly savedCredentials = savedCredentials;
  protected readonly levels = levels;

  protected readonly model = form(
    signal({
      url: '',
      name: '',
      credentials: 'saved',
      saved: 'github',
      credentialsName: '',
      username: '',
      password: '',
      level: 'advanced',
      understood: false
    }),
    path => {
      required(path.url, { message: 'Enter the remote URL' });
      pattern(path.url, /^(https:\/\/[^/\s]+\/\S+|ssh:\/\/\S+|[^@\s/]+@[^:\s/]+:\S+)$/, {
        message: 'Use an HTTPS or SSH URL'
      });
      required(path.name, { message: 'Enter a name' });
      required(path.credentialsName, {
        message: 'Enter a name for these credentials',
        when: ({ valueOf }) => valueOf(path.credentials) === 'new'
      });
      required(path.username, {
        message: 'Enter a username',
        when: ({ valueOf }) => valueOf(path.credentials) === 'new'
      });
      required(path.password, {
        message: 'Enter a password or token',
        when: ({ valueOf }) => valueOf(path.credentials) === 'new'
      });
      required(path.understood);
    }
  );

  /** A field's first error, once the user has left it (AR-6). */
  protected error(field: FieldTree<string>): string | undefined {
    const state = field();
    return state.touched() ? state.errors()[0]?.message : undefined;
  }
}

const meta: Meta<AddRepositoryFormComponent> = {
  title: 'Controls/Form',
  component: AddRepositoryFormComponent
};

export default meta;

type Story = StoryObj<AddRepositoryFormComponent>;

/** Errors show once a field has been left, and go when it is valid. */
export const AddRepository: Story = {
  play: async () => {
    const url = screen.getByRole('textbox', { name: 'Remote URL' });

    await userEvent.click(url);
    await userEvent.tab();
    await waitFor(() => expect(url).toHaveAttribute('aria-invalid', 'true'));
    await expect(screen.getByText('Enter the remote URL')).toBeVisible();

    await userEvent.type(url, 'https://github.com/acme/handbook.git');
    await waitFor(() => expect(url).not.toHaveAttribute('aria-invalid'));
    await expect(screen.getByRole('button', { name: 'Add repository' })).toBeDisabled();
  }
};

/** The same form on the smallest supported screen (NF-12.4). */
export const AddRepositoryNarrow: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: '<div class="narrow"><ui-add-repository-form /></div>'
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(screen.getByRole('radio', { name: 'Add new credentials' }));

    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);

    // A select fills its field like a text field does.
    const url = screen.getByRole('textbox', { name: 'Remote URL' });
    const level = screen.getByRole('combobox', { name: 'Git control level' });
    await expect(level.getBoundingClientRect().width).toBeCloseTo(url.getBoundingClientRect().width, 0);
  }
};
