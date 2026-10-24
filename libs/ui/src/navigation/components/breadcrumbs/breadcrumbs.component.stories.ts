import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';
import { BreadcrumbDirective } from '../../directives/breadcrumb/breadcrumb.directive';
import { BreadcrumbsComponent } from './breadcrumbs.component';

const meta: Meta<BreadcrumbsComponent> = {
  title: 'Navigation/Breadcrumbs',
  component: BreadcrumbsComponent,
  args: { label: 'Breadcrumb' },
  render: props => ({
    props,
    moduleMetadata: { imports: [ BreadcrumbDirective ] },
    template: `
      <ui-breadcrumbs [label]="label">
        <a *uiBreadcrumb href="/repositories">Repositories</a>
        <a *uiBreadcrumb href="/repositories/1">handbook</a>
        <span *uiBreadcrumb>Settings</span>
      </ui-breadcrumbs>
    `
  })
};

export default meta;

type Story = StoryObj<BreadcrumbsComponent>;

/** Repositories › handbook › Settings (NV-14). */
export const Default: Story = {};

/** A 60-character repository name on the smallest supported screen (NF-12.4). */
export const LongNames: Story = {
  render: props => ({
    props,
    moduleMetadata: { imports: [ BreadcrumbDirective ] },
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <ui-breadcrumbs [label]="label">
          <a *uiBreadcrumb href="/repositories">Repositories</a>
          <a *uiBreadcrumb href="/repositories/1">a-repository-name-of-sixty-characters-without-any-breaks-x</a>
          <span *uiBreadcrumb>Settings</span>
        </ui-breadcrumbs>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};
