import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { PasswordRevealDirective } from '../../directives/password-reveal/password-reveal.directive';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { InputComponent } from '../input/input.component';
import { TextareaComponent } from '../textarea/textarea.component';
import { FieldComponent } from './field.component';

const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk7Y3Jv8pQm0Zr1x2W9sTq5LbN4dEa6fGh front-burner@notes.example';

type FieldStory = FieldComponent & { invalid: boolean; };

const meta: Meta<FieldStory> = {
  title: 'Controls/Field',
  component: FieldComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [ IconComponent, IconButtonComponent, InputComponent, PasswordRevealDirective, TextareaComponent ]
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
  }),
  play: async ({ canvasElement }) => {
    const label = canvasElement.querySelector('.label')!.getBoundingClientRect();
    const control = canvasElement.querySelector('.control')!.getBoundingClientRect();
    const hint = canvasElement.querySelector('.hint')!.getBoundingClientRect();

    await expect(Math.round(control.top - label.bottom)).toBe(8);
    await expect(Math.round(hint.top - control.bottom)).toBe(4);
  }
};

/** A password with a reveal button (AR-20). */
export const Password: Story = {
  render: () => ({
    styles: [ width ],
    template: `
      <div class="form">
        <ui-field label="Password or token" hint="GitHub and Bitbucket need an access token, not your account password.">
          <input uiInput #secret type="password" value="ghp_example" />
          <button uiIconButton [uiPasswordReveal]="secret" label="Show password">
            <ui-icon name="eye" />
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
