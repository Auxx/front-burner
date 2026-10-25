import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type FieldTree, form, FormField, pattern, required } from '@angular/forms/signals';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { IconComponent } from '../content/components/icon/icon.component';
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
    IconComponent,
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
              <ui-icon name="eye" />
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
