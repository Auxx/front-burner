import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { MenuGroupDirective } from '../../directives/menu-group/menu-group.directive';
import { MenuTriggerDirective } from '../../directives/menu-trigger/menu-trigger.directive';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { MenuSeparatorComponent } from '../menu-separator/menu-separator.component';
import { MenuComponent } from './menu.component';

// Codicons `repo-fetch`, `repo-pull` and `repo-push` (CC-BY-4.0), inline until
// the Icon component exists.
const icons = {
  fetch:
    'M7.5 3C7.776 3 8 2.776 8 2.5V1.5C8 1.224 7.776 1 7.5 1C7.224 1 7 1.224 7 1.5V2.5C7 2.776 7.224 3 7.5 3Z M7.5 10C7.372 10 7.245 9.95 7.15 9.85L4.15 6.85C4.05 6.755 4 6.628 4 6.5C4 6.372 4.05 6.245 4.15 6.15C4.245 6.05 4.373 6 4.5 6C4.627 6 4.755 6.05 4.85 6.15L7 8.29V7.5C7 7.22 7.22 7 7.5 7C7.78 7 8 7.22 8 7.5V8.29L10.15 6.15C10.245 6.05 10.372 6 10.5 6C10.628 6 10.755 6.05 10.85 6.15C10.95 6.245 11 6.373 11 6.5C11 6.627 10.95 6.755 10.85 6.85L7.85 9.85C7.755 9.95 7.628 10 7.5 10Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14C6.29 14.58 6.85 15 7.5 15Z M8 5.5C8 5.776 7.776 6 7.5 6C7.224 6 7 5.776 7 5.5V4.5C7 4.224 7.224 4 7.5 4C7.776 4 8 4.224 8 4.5V5.5Z',
  pull:
    'M4.85 6.15C4.755 6.05 4.627 6 4.5 6C4.372 6 4.245 6.05 4.15 6.15C4.05 6.245 4 6.373 4 6.5C4 6.627 4.05 6.755 4.15 6.85L7.15 9.85C7.245 9.95 7.372 10 7.5 10C7.628 10 7.755 9.95 7.85 9.85L10.85 6.85C10.95 6.755 11 6.628 11 6.5C11 6.372 10.95 6.245 10.85 6.15C10.755 6.05 10.627 6 10.5 6C10.373 6 10.245 6.05 10.15 6.15L8 8.29V1.5C8 1.22 7.78 1 7.5 1C7.22 1 7 1.22 7 1.5V8.29L4.85 6.15Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z',
  push:
    'M4.85 4.85C4.755 4.95 4.627 5 4.5 5C4.372 5 4.245 4.95 4.15 4.85C4.05 4.755 4 4.627 4 4.5C4 4.373 4.05 4.245 4.15 4.15L7.15 1.15C7.245 1.05 7.372 1 7.5 1C7.628 1 7.755 1.05 7.85 1.15L10.85 4.15C10.95 4.245 11 4.372 11 4.5C11 4.628 10.95 4.755 10.85 4.85C10.755 4.95 10.627 5 10.5 5C10.373 5 10.245 4.95 10.15 4.85L8 2.71V9.5C8 9.78 7.78 10 7.5 10C7.22 10 7 9.78 7 9.5V2.71L4.85 4.85Z M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z'
};

const meta: Meta<MenuComponent> = {
  title: 'Navigation/Menu',
  component: MenuComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [ MenuGroupDirective, MenuItemComponent, MenuSeparatorComponent, MenuTriggerDirective ]
      }
    })
  ]
};

export default meta;

type Story = StoryObj<MenuComponent>;

/** The git actions of a repository (GA-7); Push is disabled. */
export const GitActions: Story = {
  render: () => ({
    props: { icons },
    styles: [ 'svg { inline-size: var(--ui-icon-size); block-size: var(--ui-icon-size); }' ],
    template: `
      <button [uiMenuTrigger]="actions.aria">Git actions</button>
      <ui-menu #actions="uiMenu">
        <button uiMenuItem="fetch">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.fetch" /></svg>
          Fetch
        </button>
        <button uiMenuItem="pull">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.pull" /></svg>
          Pull
        </button>
        <button uiMenuItem="push" [disabled]="true">
          <svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path [attr.d]="icons.push" /></svg>
          Push
        </button>
      </ui-menu>
    `
  }),
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'Git actions' });

    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Fetch' })).toHaveFocus());

    await userEvent.keyboard('{ArrowDown}');
    await expect(screen.getByRole('menuitem', { name: 'Pull' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
};

/** The repository switcher of the app header (NV-10). */
export const RepositorySwitcher: Story = {
  render: () => ({
    template: `
      <button [uiMenuTrigger]="repositories.aria">Repositories</button>
      <ui-menu #repositories="uiMenu">
        <div uiMenuGroup label="Recent repositories">
          <button uiMenuItem="notes">notes</button>
          <button uiMenuItem="handbook">team-handbook</button>
          <button uiMenuItem="website">website-content</button>
        </div>
        <div uiMenuSeparator></div>
        <a uiMenuItem="all" href="/repositories">All repositories</a>
        <a uiMenuItem="settings" href="/repositories/1/settings">Repository settings</a>
      </ui-menu>
    `
  })
};

/** A trigger at the inline end of a narrow screen: the menu stays on it. */
export const NearTheEdge: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => ({
    styles: [ '.edge { display: flex; justify-content: flex-end; inline-size: 20rem; margin-inline-start: auto; }' ],
    template: `
      <div class="edge">
        <button [uiMenuTrigger]="more.aria">More</button>
      </div>
      <ui-menu #more="uiMenu">
        <button uiMenuItem="rename">Rename repository</button>
        <button uiMenuItem="remove">Remove repository</button>
      </ui-menu>
    `
  }),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu');

    await waitFor(() => expect(menu).toBeVisible());
    await expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  }
};
