import { signal } from '@angular/core';
import { Meta, StoryObj } from '@storybook/angular-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { ChoiceComponent } from '../choice/choice.component';
import { CheckboxComponent } from './checkbox.component';

const meta: Meta<CheckboxComponent> = {
  title: 'Controls/Checkbox',
  component: CheckboxComponent,
  decorators: [
    story => ({
      ...story(),
      moduleMetadata: { imports: [ ChoiceComponent ] }
    })
  ]
};

export default meta;

type Story = StoryObj<CheckboxComponent>;

const column = '.column { display: flex; flex-direction: column; align-items: start; }';

/** Unchecked, checked, mixed and disabled. */
export const States: Story = {
  render: () => ({
    styles: [ column ],
    template: `
      <div class="column">
        <label uiChoice><input type="checkbox" uiCheckbox /> Unchecked</label>
        <label uiChoice><input type="checkbox" uiCheckbox checked /> Checked</label>
        <label uiChoice><input type="checkbox" uiCheckbox [indeterminate]="true" /> Mixed</label>
        <label uiChoice><input type="checkbox" uiCheckbox disabled /> Disabled</label>
        <label uiChoice><input type="checkbox" uiCheckbox disabled checked /> Disabled and checked</label>
      </div>
    `
  })
};

const files = [ 'README.md', 'docs/guide.md', 'docs/setup.md' ];

/** The Changes list: one checkbox per file and one for all of them (GA-17). */
export const ChangesList: Story = {
  render: () => {
    const ticked = signal(new Set(files));
    return {
      props: {
        files,
        ticked,
        toggle: (file: string) =>
          ticked.update(set => {
            const next = new Set(set);
            if (!next.delete(file)) {
              next.add(file);
            }
            return next;
          }),
        toggleAll: () => ticked.update(set => new Set(set.size === files.length ? [] : files))
      },
      styles: [ column ],
      template: `
        <div class="column">
          <label uiChoice>
            <input
              type="checkbox"
              uiCheckbox
              [checked]="ticked().size === files.length"
              [indeterminate]="ticked().size > 0 && ticked().size < files.length"
              (change)="toggleAll()"
            />
            All files
          </label>
          @for (file of files; track file) {
            <input type="checkbox" uiCheckbox [attr.aria-label]="file" [checked]="ticked().has(file)" (change)="toggle(file)" />
          }
        </div>
      `
    };
  },
  play: async () => {
    const all = screen.getByRole('checkbox', { name: 'All files' }) as HTMLInputElement;

    await userEvent.click(screen.getByRole('checkbox', { name: 'README.md' }));
    await expect(all.matches(':indeterminate')).toBe(true);

    await userEvent.click(all);
    for (const file of files) {
      await expect(screen.getByRole('checkbox', { name: file })).toBeChecked();
    }
  }
};

/** A long label on the smallest supported screen (AR-29, NF-12.4). */
export const Understood: Story = {
  render: () => ({
    styles: [ '.narrow { inline-size: 20rem; }' ],
    template: `
      <div class="narrow">
        <label uiChoice><input type="checkbox" uiCheckbox /> I have added this key to my git server</label>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('.narrow') as HTMLElement;
    await expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  }
};
