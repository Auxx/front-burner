import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect } from 'storybook/test';

import { IslandComponent } from '../../../layout/components/island/island.component';
import { KeyValueComponent } from '../key-value/key-value.component';
import { KeyValueListComponent } from './key-value-list.component';

const meta: Meta<KeyValueListComponent> = {
  title: 'Content/KeyValueList',
  component: KeyValueListComponent,
  decorators: [
    story => ({ ...story(), moduleMetadata: { imports: [ IslandComponent, KeyValueComponent ] } })
  ]
};

export default meta;

type Story = StoryObj<KeyValueListComponent>;

const styles = [
  '.canvas { max-inline-size: 36rem; }',
  '.narrow { inline-size: 320px; }',
  '.description { display: block; color: var(--ui-text-muted); }',
  // An island leaves its content's padding to the content.
  'dl { padding: 0 var(--ui-space-3) var(--ui-space-3); }'
];

const hostKey = `
  <ui-island heading="Changed host key">
    <dl uiKeyValueList>
      <div uiKeyValue label="Host">github.com</div>
      <div uiKeyValue label="Trusted key" mono>ED25519 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU</div>
      <div uiKeyValue label="New key" mono>ED25519 SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8</div>
    </dl>
  </ui-island>
`;

/** A repository's clone details (RM-16). */
export const CloneDetails: Story = {
  render: () => ({
    styles,
    template: `
      <div class="canvas">
        <ui-island heading="Clone details">
          <dl uiKeyValueList>
            <div uiKeyValue label="Clone mode">Single branch: main</div>
            <div uiKeyValue label="Git control level">
              Advanced
              <span class="description">Full control over branches, commits and sync.</span>
            </div>
            <div uiKeyValue label="Added">25 October 2026</div>
          </dl>
        </ui-island>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const [ dt ] = canvasElement.querySelectorAll('dt');
    const [ dd ] = canvasElement.querySelectorAll('dd');
    await expect(dd.getBoundingClientRect().top).toBe(dt.getBoundingClientRect().top);
  }
};

/** The SSH key a repository uses (RM-14). */
export const SshCredentials: Story = {
  render: () => ({
    styles,
    template: `
      <div class="canvas">
        <ui-island heading="Credentials">
          <dl uiKeyValueList>
            <div uiKeyValue label="Name">Work deploy key</div>
            <div uiKeyValue label="Kind">SSH key</div>
            <div uiKeyValue label="Key type">ED25519</div>
            <div uiKeyValue label="Fingerprint" mono>SHA256:Ht3Vr8Kp1QwZ6sLm9YbN2cXa7DfGjQ4kRt5Uv8WxYz0</div>
            <div uiKeyValue label="Passphrase">Protected</div>
          </dl>
        </ui-island>
      </div>
    `
  })
};

/** The trusted and the new host key of a changed host key (RC-21). */
export const ChangedHostKey: Story = {
  render: () => ({
    styles,
    template: `<div class="canvas">${hostKey}</div>`
  })
};

/** At 320 CSS px each value sits under its label, and the fingerprints wrap (NF-12.4). */
export const Narrow: Story = {
  render: () => ({
    styles,
    template: `<div class="narrow">${hostKey}</div>`
  }),
  play: async ({ canvasElement }) => {
    // The island's body would scroll an overflow away, so the list and its values are measured.
    const list = canvasElement.querySelector('dl') as HTMLElement;
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    for (const item of canvasElement.querySelectorAll('[uiKeyValue]')) {
      const dt = (item.querySelector('dt') as HTMLElement).getBoundingClientRect();
      const value = item.querySelector('dd') as HTMLElement;
      await expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
      await expect(value.getBoundingClientRect().top).toBeGreaterThanOrEqual(dt.bottom);
    }
  }
};
