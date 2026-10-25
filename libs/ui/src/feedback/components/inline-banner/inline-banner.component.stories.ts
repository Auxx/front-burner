import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { BannerActionsComponent } from '../../components/banner-actions/banner-actions.component';
import { InlineBannerComponent } from './inline-banner.component';

const meta: Meta<InlineBannerComponent> = {
  title: 'Feedback/Inline banner',
  component: InlineBannerComponent,
  decorators: [
    story => ({ ...story(), moduleMetadata: { imports: [ BannerActionsComponent, ButtonComponent ] } })
  ]
};

export default meta;

type Story = StoryObj<InlineBannerComponent>;

const stack = '.stack { display: grid; gap: var(--ui-space-2); }';

/** One banner per status. */
export const Statuses: Story = {
  render: () => ({
    styles: [ stack ],
    template: `
      <div class="stack">
        <ui-inline-banner status="info">Front Burner fetches every 2 minutes.</ui-inline-banner>
        <ui-inline-banner status="success">Merge committed.</ui-inline-banner>
        <ui-inline-banner status="warning">Credentials were refused by the remote.</ui-inline-banner>
        <ui-inline-banner status="danger">The working copy is missing or damaged.</ui-inline-banner>
      </div>
    `
  })
};

/** The global banners below the app header, square and full width (NV-15). */
export const NewVersion: Story = {
  render: () => ({
    styles: [ stack, 'ui-inline-banner { --ui-inline-banner-radius: 0; }' ],
    template: `
      <div class="stack">
        <ui-inline-banner>
          A new version of Front Burner is available.
          <div uiBannerActions><button uiButton size="small" variant="primary">Reload</button></div>
        </ui-inline-banner>
        <ui-inline-banner status="warning">
          You're offline. Changes are kept and saved when you're back online.
        </ui-inline-banner>
      </div>
    `
  })
};

/** The locked-key banner with a long key name, on a phone (RC-15, NF-12.4). */
export const LockedKey: Story = {
  render: () => ({
    props: { shown: true },
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        @if (shown) {
          <ui-inline-banner status="warning" dismissLabel="Dismiss" announce (dismissed)="shown = false">
            <strong>work-laptop-ed25519-key-for-the-acme-handbook-repository-2026</strong> is locked.
            Unlock it to fetch, pull and push.
            <div uiBannerActions><button uiButton size="small">Unlock</button></div>
          </ui-inline-banner>
        }
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await expect(canvasElement.querySelector('ui-inline-banner')).toBeNull();
  }
};

/** The editor's question when the open file changed while it was edited (ED-24). */
export const FileChanged: Story = {
  render: () => ({
    template: `
      <ui-inline-banner status="warning" announce>
        This file changed while you were editing.
        <div uiBannerActions>
          <button uiButton size="small">Reload</button>
          <button uiButton size="small">Keep mine</button>
        </div>
      </ui-inline-banner>
    `
  })
};

/** The preview's quiet notice about removed HTML (SH-17). */
export const RemovedHtml: Story = {
  render: () => ({
    template: `
      <ui-inline-banner quiet>
        Some HTML isn't shown in the preview.
        <div uiBannerActions>
          <button uiButton size="small" variant="ghost">Details</button>
          <button uiButton size="small" variant="ghost">Hide</button>
        </div>
      </ui-inline-banner>
    `
  })
};
