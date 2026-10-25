import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { PasswordRevealDirective } from '../../directives/password-reveal/password-reveal.directive';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { InputComponent } from '../input/input.component';
import { TextareaComponent } from '../textarea/textarea.component';
import { FieldComponent } from './field.component';

// Codicon `eye` (CC-BY-4.0), inline until the Icon component exists.
const eye =
  'M2.98444 8.62471L2.98346 8.62815C2.91251 8.8948 2.63879 9.05404 2.37202 8.9833C1.94098 8.86907 2.01687 8.37186 2.01687 8.37186L2.03453 8.31047C2.03453 8.31047 2.06063 8.22636 2.08166 8.1653C2.12369 8.04329 2.18795 7.87274 2.27931 7.66977C2.46154 7.26493 2.75443 6.72477 3.19877 6.18295C4.09629 5.08851 5.60509 4 8.00017 4C10.3952 4 11.904 5.08851 12.8016 6.18295C13.2459 6.72477 13.5388 7.26493 13.721 7.66977C13.8124 7.87274 13.8766 8.04329 13.9187 8.1653C13.9397 8.22636 13.9552 8.27541 13.9658 8.31047C13.9711 8.328 13.9752 8.34204 13.9781 8.35236L13.9816 8.365L13.9827 8.36916L13.9832 8.37069L13.9835 8.37186C14.0542 8.63878 13.8952 8.91253 13.6283 8.9833C13.3618 9.05397 13.0885 8.89556 13.0172 8.62937L13.0169 8.62815L13.0159 8.62471L13.0085 8.5997C13.0014 8.57616 12.9898 8.53927 12.9732 8.49095C12.9399 8.39422 12.8866 8.25227 12.8091 8.08023C12.6538 7.73508 12.4041 7.27523 12.0283 6.81706C11.2857 5.9115 10.0445 5 8.00017 5C5.95584 5 4.71464 5.9115 3.97201 6.81706C3.59627 7.27523 3.34655 7.73508 3.19119 8.08023C3.11375 8.25227 3.06047 8.39422 3.02715 8.49095C3.01051 8.53927 2.9989 8.57616 2.99179 8.5997L2.98444 8.62471ZM8.00024 7C6.61953 7 5.50024 8.11929 5.50024 9.5C5.50024 10.8807 6.61953 12 8.00024 12C9.38096 12 10.5002 10.8807 10.5002 9.5C10.5002 8.11929 9.38096 7 8.00024 7ZM6.50024 9.5C6.50024 8.67157 7.17182 8 8.00024 8C8.82867 8 9.50024 8.67157 9.50024 9.5C9.50024 10.3284 8.82867 11 8.00024 11C7.17182 11 6.50024 10.3284 6.50024 9.5Z';

const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk7Y3Jv8pQm0Zr1x2W9sTq5LbN4dEa6fGh front-burner@notes.example';

type FieldStory = FieldComponent & { invalid: boolean; };

const meta: Meta<FieldStory> = {
  title: 'Controls/Field',
  component: FieldComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [ IconButtonComponent, InputComponent, PasswordRevealDirective, TextareaComponent ]
      }
    })
  ]
};

export default meta;

type Story = StoryObj<FieldStory>;

const width = '.form { max-inline-size: 30rem; }';

/** The remote URL of the Add repository form, with its error (AR-9). */
export const RemoteUrl: Story = {
  args: { invalid: true },
  render: props => ({
    props,
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Remote URL" hint="An HTTPS or SSH URL" [error]="invalid ? 'Use an HTTPS or SSH URL' : undefined">
          <input uiInput value="git://github.com/acme/handbook.git" />
        </ui-field>
      </div>
    `
  })
};

/** A password with a reveal button (AR-20). */
export const Password: Story = {
  render: () => ({
    props: { eye },
    styles: [ width, 'svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }' ],
    template: `
      <div class="form">
        <ui-field label="Password or token" hint="GitHub and Bitbucket need an access token, not your account password.">
          <input uiInput #secret type="password" value="ghp_example" />
          <button uiIconButton [uiPasswordReveal]="secret" label="Show password">
            <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="eye" /></svg>
          </button>
        </ui-field>
      </div>
    `
  }),
  play: async () => {
    const input = screen.getByLabelText('Password or token') as HTMLInputElement;

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

    await expect(input.type).toBe('text');
  }
};

/** A pasted private key (AR-26), and a generated public key to copy (AR-29). */
export const PrivateKey: Story = {
  render: () => ({
    props: { publicKey },
    styles: [ '.narrow { display: flex; flex-direction: column; gap: var(--ui-space-3); inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <ui-field label="Private key">
          <textarea uiTextarea code rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
        </ui-field>
        <ui-field label="Public key">
          <textarea uiTextarea code rows="3" readonly [value]="publicKey"></textarea>
        </ui-field>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};

/** The commit message (GA-18). */
export const CommitMessage: Story = {
  render: () => ({
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Message">
          <textarea uiTextarea rows="4"></textarea>
        </ui-field>
      </div>
    `
  })
};

/** A disabled field with a value. */
export const Disabled: Story = {
  render: () => ({
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Repository name">
          <input uiInput value="handbook" disabled />
        </ui-field>
      </div>
    `
  })
};
