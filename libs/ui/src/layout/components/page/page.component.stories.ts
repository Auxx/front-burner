import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { FieldComponent } from '../../../controls/components/field/field.component';
import { InputComponent } from '../../../controls/components/input/input.component';
import { BreadcrumbDirective } from '../../../navigation/directives/breadcrumb/breadcrumb.directive';
import { PageTitleDirective } from '../../directives/page-title/page-title.directive';
import { PageComponent } from './page.component';

const meta: Meta<PageComponent> = {
  title: 'Layout/Page',
  component: PageComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [ BreadcrumbDirective, ButtonComponent, FieldComponent, InputComponent, PageTitleDirective ]
      }
    })
  ],
  args: { breadcrumbsLabel: 'Breadcrumb', column: null }
};

export default meta;

type Story = StoryObj<PageComponent>;

// The canvas around the island, as the app shell's body pads it.
const canvas = `.canvas {
  display: grid;
  block-size: 100dvh;
  box-sizing: border-box;
  padding: var(--ui-page-padding-block-start) var(--ui-page-padding-inline) var(--ui-page-padding-block-end);
}`;

const form = `
  <ui-field label="Remote URL"><input uiInput type="url" /></ui-field>
  <ui-field label="Name"><input uiInput /></ui-field>
  <div><button uiButton variant="primary" type="button">Add repository</button></div>
`;

/** A top-level page, such as the dashboard: the title bar is only the `h1`. */
export const TopLevel: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-page [breadcrumbsLabel]="breadcrumbsLabel" [column]="column">
          <h1 uiPageTitle>Dashboard</h1>
          <p>Recent repositories are listed here.</p>
        </ui-page>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('nav')).toBeNull();
  }
};

/** Repositories › **Add repository** (NV-14). */
export const WithAncestors: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-page [breadcrumbsLabel]="breadcrumbsLabel" [column]="column">
          <a *uiBreadcrumb href="/repositories">Repositories</a>
          <h1 uiPageTitle>Add repository</h1>
          ${form}
        </ui-page>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const nav = canvasElement.querySelector('nav') as HTMLElement;
    const h1 = canvasElement.querySelector('h1') as HTMLElement;
    await expect(nav.contains(h1)).toBe(false);
    // One line: the h1 sits beside the breadcrumbs.
    await expect(h1.getBoundingClientRect().top).toBeCloseTo(nav.getBoundingClientRect().top, -1);
  }
};

/** The content in a centred column of 40rem, as on the Add repository page. */
export const CentredColumn: Story = {
  ...WithAncestors,
  args: { column: '40rem' },
  play: async ({ canvasElement }) => {
    const column = canvasElement.querySelector('.column') as HTMLElement;
    const island = canvasElement.querySelector('ui-island') as HTMLElement;
    const left = column.getBoundingClientRect().left - island.getBoundingClientRect().left;
    const right = island.getBoundingClientRect().right - column.getBoundingClientRect().right;
    await expect(left).toBeCloseTo(right, 0);
  }
};

/** A 60-character ancestor on the smallest supported screen wraps (NF-12.4). */
export const LongNames: Story = {
  render: props => ({
    props,
    styles: [ canvas, '.canvas { inline-size: 20rem; }' ],
    template: `
      <div class="canvas">
        <ui-page [breadcrumbsLabel]="breadcrumbsLabel" [column]="column">
          <a *uiBreadcrumb href="/repositories">Repositories</a>
          <a *uiBreadcrumb href="/repositories/1">a-repository-name-of-sixty-characters-without-any-breaks-x</a>
          <h1 uiPageTitle>Settings</h1>
        </ui-page>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const island = canvasElement.querySelector('ui-island') as HTMLElement;
    await expect(island.scrollWidth).toBeLessThanOrEqual(island.clientWidth);
  }
};
