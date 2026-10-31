import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { IslandComponent } from '../island/island.component';
import { SplitPaneComponent } from './split-pane.component';

// `.positioned` stands for content such as CodeMirror's `position: relative` editor.
const canvas = `
  .canvas { display: grid; block-size: 24rem; padding: var(--ui-island-gap); }
  .positioned { position: relative; block-size: 100%; }
`;

const presets = [ { label: 'Small', size: 25 }, { label: 'Half', size: 50 }, { label: 'Large', size: 75 } ];

/**
 * The menu button is centred on the separator on both axes, sits above it
 * without blocking it elsewhere, and a drag started just outside the button
 * resizes.
 */
async function expectHandleOnSeparator(canvasElement: HTMLElement, vertical: boolean): Promise<void> {
  const separator = within(canvasElement).getByRole('separator');
  const button = within(canvasElement).getByRole('button', { name: 'Pane sizes' });
  const s = separator.getBoundingClientRect();
  const b = button.getBoundingClientRect();
  await expect(Math.abs(b.left + b.width / 2 - (s.left + s.width / 2))).toBeLessThanOrEqual(1);
  await expect(Math.abs(b.top + b.height / 2 - (s.top + s.height / 2))).toBeLessThanOrEqual(1);

  const x = vertical ? b.right + 4 : s.left + s.width / 2;
  const y = vertical ? s.top + s.height / 2 : b.bottom + 4;
  await expect(canvasElement.ownerDocument.elementFromPoint(x, y)).toBe(separator);

  const before = Number(separator.getAttribute('aria-valuenow'));
  await userEvent.pointer([
    { keys: '[MouseLeft>]', target: separator, coords: { clientX: x, clientY: y } },
    { coords: { clientX: vertical ? x : x + 40, clientY: vertical ? y + 40 : y } },
    { keys: '[/MouseLeft]' }
  ]);
  await expect(Number(separator.getAttribute('aria-valuenow'))).not.toBe(before);
}

const meta: Meta<SplitPaneComponent> = {
  title: 'Layout/Split pane',
  component: SplitPaneComponent,
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [ story => ({ ...story(), moduleMetadata: { imports: [ IslandComponent ] } }) ],
  args: { size: 30, orientation: 'horizontal', show: 'both', presets, presetsLabel: 'Pane sizes' },
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-split-pane [(size)]="size" [orientation]="orientation" [show]="show" [presets]="presets" [presetsLabel]="presetsLabel" separatorLabel="Resize first pane">
          <ui-island uiSplitPaneStart heading="First"><p>First pane</p></ui-island>
          <ui-island uiSplitPaneEnd heading="Second"><p class="positioned">Second pane</p></ui-island>
        </ui-split-pane>
      </div>
    `
  })
};

export default meta;

type Story = StoryObj<SplitPaneComponent>;

export const Horizontal: Story = {
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator');
    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(separator).toHaveAttribute('aria-valuenow', '35');

    // The target is at least 24 px wide (NF-13.5) and grows into the end pane,
    // above its content, leaving the start island's edge and scrollbar alone.
    const { left, top, height } = separator.getBoundingClientRect();
    // Away from the menu button, which sits at the middle.
    const y = top + height / 8;
    const at = (x: number) => canvasElement.ownerDocument.elementFromPoint(x, y);
    await expect(at(left - 2)).not.toBe(separator);
    await expect(at(left + 1)).toBe(separator);
    await expect(at(left + 23)).toBe(separator);

    await expectHandleOnSeparator(canvasElement, false);
  }
};

/** In right-to-left the panes swap sides; the button stays centred. */
export const HorizontalRtl: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas" dir="rtl">
        <ui-split-pane [(size)]="size" [presets]="presets" presetsLabel="Pane sizes" separatorLabel="Resize first pane">
          <ui-island uiSplitPaneStart heading="First"><p>First pane</p></ui-island>
          <ui-island uiSplitPaneEnd heading="Second"><p>Second pane</p></ui-island>
        </ui-split-pane>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    await expectHandleOnSeparator(canvasElement, false);
  }
};

export const Vertical: Story = {
  args: { orientation: 'vertical', size: 60 },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Pane sizes' });

    await expectHandleOnSeparator(canvasElement, true);
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Large' }));

    await waitFor(() => expect(within(canvasElement).getByRole('separator')).toHaveAttribute('aria-valuenow', '75'));
    await expect(trigger).toHaveFocus();
  }
};

export const OnePane: Story = {
  args: { show: 'end' }
};

/** The repository screen: the file tree, then the editor and the preview. */
export const Nested: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-split-pane [(size)]="size" separatorLabel="Resize file tree">
          <ui-island uiSplitPaneStart heading="Files"><p>Tree</p></ui-island>
          <ui-split-pane uiSplitPaneEnd separatorLabel="Resize editor">
            <ui-island uiSplitPaneStart heading="Editor"><p>Editor</p></ui-island>
            <ui-island uiSplitPaneEnd heading="Preview"><p>Preview</p></ui-island>
          </ui-split-pane>
        </ui-split-pane>
      </div>
    `
  })
};

/**
 * The editor and the preview: a straight line in the canvas colour replaces
 * the gap, and the separator keeps its 24 px target. In forced colours the line
 * is `--ui-split-pane-line-forced`.
 */
export const LineDivider: Story = {
  render: props => ({
    props,
    styles: [ canvas ],
    template: `
      <div class="canvas">
        <ui-split-pane
          style="--ui-split-pane-gap: calc(var(--ui-border-width) * 2); --ui-split-pane-line: var(--ui-surface-canvas); --ui-split-pane-line-forced: CanvasText"
          [(size)]="size"
          separatorLabel="Resize first pane"
        >
          <ui-island uiSplitPaneStart heading="Editor"><p>Editor</p></ui-island>
          <ui-island uiSplitPaneEnd heading="Preview"><p>Preview</p></ui-island>
        </ui-split-pane>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator');
    const divider = separator.parentElement as HTMLElement;
    const canvasColour = getComputedStyle(canvasElement.ownerDocument.documentElement)
      .getPropertyValue('--ui-surface-canvas').trim();
    const probe = canvasElement.ownerDocument.createElement('i');
    probe.style.color = canvasColour;
    canvasElement.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();

    await expect(divider.getBoundingClientRect().width).toBe(2);
    await expect(getComputedStyle(divider).backgroundColor).toBe(expected);
    await expect(getComputedStyle(separator, '::before').width).not.toBe('auto');
    await expect(parseFloat(getComputedStyle(separator, '::before').width)).toBeGreaterThanOrEqual(24);
  }
};
