import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { FieldComponent } from '../../../controls/components/field/field.component';
import { InputComponent } from '../../../controls/components/input/input.component';
import { InlineBannerComponent } from '../../../feedback/components/inline-banner/inline-banner.component';
import { CentredIslandComponent } from './centred-island.component';

const meta: Meta<CentredIslandComponent> = {
  title: 'Layout/Centred island',
  component: CentredIslandComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: { imports: [ ButtonComponent, FieldComponent, InlineBannerComponent, InputComponent ] }
    })
  ],
  args: { width: '24rem' }
};

export default meta;

type Story = StoryObj<CentredIslandComponent & { lines: number[]; }>;

const canvas = '.canvas { display: grid; block-size: 100dvh; box-sizing: border-box; }';

const form = `
  <h1>Log in</h1>
  <ui-field label="Email"><input uiInput type="email" /></ui-field>
  <ui-field label="Password"><input uiInput type="password" /></ui-field>
  <button uiButton variant="primary" type="button">Log in</button>
`;

export const Default: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `<div class="canvas"><ui-centred-island [width]="width">${form}</ui-centred-island></div>`
  })
};

export const WithBannersAfter: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-centred-island [width]="width">
          ${form}
          <ui-inline-banner uiCentredIslandAfter status="danger">That email or password is not right.</ui-inline-banner>
          <ui-inline-banner uiCentredIslandAfter status="warning">This connection is not secure.</ui-inline-banner>
        </ui-centred-island>
      </div>
    `
  })
};

/** A column taller than the window scrolls from its top, never off it. */
export const TallerThanTheWindow: Story = {
  args: { lines: Array.from({ length: 40 }, (_, index) => index) },
  render: props => ({
    props,
    styles: [ canvas, '.canvas { overflow: auto; }' ],
    template: `
      <div class="canvas">
        <ui-centred-island [width]="width">
          <h1>A long step</h1>
          @for (line of lines; track $index) {
            <p>Line {{ $index + 1 }}</p>
          }
        </ui-centred-island>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const island = canvasElement.querySelector('ui-island') as HTMLElement;
    expect(island.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  }
};
