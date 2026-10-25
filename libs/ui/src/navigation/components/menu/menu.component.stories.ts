import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { IconComponent } from '../../../content/components/icon/icon.component';
import { MenuGroupDirective } from '../../directives/menu-group/menu-group.directive';
import { MenuTriggerDirective } from '../../directives/menu-trigger/menu-trigger.directive';
import { MenuItemComponent } from '../menu-item/menu-item.component';
import { MenuSeparatorComponent } from '../menu-separator/menu-separator.component';
import { MenuComponent } from './menu.component';

const meta: Meta<MenuComponent> = {
  title: 'Navigation/Menu',
  component: MenuComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: {
        imports: [ IconComponent, MenuGroupDirective, MenuItemComponent, MenuSeparatorComponent, MenuTriggerDirective ]
      }
    })
  ]
};

export default meta;

type Story = StoryObj<MenuComponent>;

/** The git actions of a repository (GA-7); Push is disabled. */
export const GitActions: Story = {
  render: () => ({
    template: `
      <button [uiMenuTrigger]="actions.aria">Git actions</button>
      <ui-menu #actions="uiMenu">
        <button uiMenuItem="fetch">
          <ui-icon name="repo-fetch" />
          Fetch
        </button>
        <button uiMenuItem="pull">
          <ui-icon name="repo-pull" />
          Pull
        </button>
        <button uiMenuItem="push" [disabled]="true">
          <ui-icon name="repo-push" />
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
