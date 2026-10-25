import { ComboboxHarness } from '@angular/aria/combobox/testing';
import { ListboxHarness } from '@angular/aria/listbox/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { disabled, form, FormField } from '@angular/forms/signals';

import { SelectOptionDirective } from '../../directives/select-option/select-option.directive';
import { type ChoiceOption } from '../../models/choice-option.model';
import { FieldComponent } from '../field/field.component';
import { SelectComponent } from './select.component';

const levels: readonly ChoiceOption<string>[] = [
  { value: 'simple', label: 'Simple', description: 'Git is hidden' },
  { value: 'guided', label: 'Guided', description: 'Git in plain language', disabled: true },
  { value: 'advanced', label: 'Advanced', description: 'Full control over git' }
];

@Component({
  imports: [ FieldComponent, FormField, SelectComponent ],
  template: `
    <ui-field label="Git control level" [error]="error()">
      <ui-select [options]="options()" [formField]="model.level" placeholder="Choose a level" />
    </ui-field>
    <button>Next</button>
  `
})
class HostComponent {
  readonly locked = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly options = signal(levels);
  readonly model = form(signal({ level: 'advanced' }), path => {
    disabled(path.level, () => this.locked());
  });
}

@Component({
  imports: [ SelectComponent, SelectOptionDirective ],
  template: `
    <ui-select [options]="options" [(value)]="value" aria-label="Key">
      <ng-template uiSelectOption let-option><code>{{ option.value }}</code></ng-template>
    </ui-select>
  `
})
class TemplateHostComponent {
  readonly options = levels;
  value: string | undefined = 'simple';
}

describe('SelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let loader: HarnessLoader;

  const trigger = () => fixture.nativeElement.querySelector('[role="combobox"]') as HTMLElement;
  const text = () => trigger().querySelector('.value') as HTMLElement;
  const options = () => [ ...document.querySelectorAll('.cdk-overlay-container [role="option"]') ] as HTMLElement[];
  const option = (label: string) => options().find(element => element.textContent?.includes(label)) as HTMLElement;
  const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '');
  const press = async (key: string) => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await fixture.whenStable();
  };
  const open = async () => {
    trigger().focus();
    await press('ArrowDown');
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent, TemplateHostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  it('is a labelled, collapsed combobox showing the selected label', async () => {
    const combobox = await loader.getHarness(ComboboxHarness);
    const label = fixture.nativeElement.querySelector('ui-field label') as HTMLElement;

    expect(await combobox.isOpen()).toBe(false);
    expect(trigger().getAttribute('aria-labelledby')).toBe(label.id);
    expect(text().textContent?.trim()).toBe('Advanced');
  });

  it('focuses the select when its label is clicked', () => {
    (fixture.nativeElement.querySelector('ui-field label') as HTMLElement).click();

    expect(document.activeElement).toBe(trigger());
  });

  it('opens a listbox of the options with the selected one marked', async () => {
    const combobox = await loader.getHarness(ComboboxHarness);

    await combobox.open();
    const listbox = await combobox.getPopupWidget(ListboxHarness);
    const harnessOptions = await listbox.getOptions();

    expect(await combobox.isOpen()).toBe(true);
    expect(harnessOptions.length).toBe(3);
    expect(await harnessOptions[2].isSelected()).toBe(true);
    expect(await harnessOptions[1].isDisabled()).toBe(true);
    expect(option('Simple').textContent).toContain('Git is hidden');
    expect(option('Advanced').querySelector('.check')).not.toBeNull();
  });

  it('chooses with the keyboard and closes', async () => {
    await open();
    await press('Home');
    expect(active()?.textContent).toContain('Simple');

    await press('Enter');

    expect(host.model.level().value()).toBe('simple');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
    expect(text().textContent?.trim()).toBe('Simple');
  });

  it('chooses with a click', async () => {
    await open();

    option('Simple').click();
    await fixture.whenStable();

    expect(host.model.level().value()).toBe('simple');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('skips disabled options', async () => {
    await open();
    await press('Home');

    await press('ArrowDown');

    expect(active()?.textContent).toContain('Advanced');
  });

  it('closes on Escape without changing the value', async () => {
    await open();
    await press('Home');

    await press('Escape');

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(host.model.level().value()).toBe('advanced');
  });

  it('shows the placeholder for a value that is not an option', async () => {
    host.model.level().value.set('expert');
    await fixture.whenStable();

    expect(text().textContent?.trim()).toBe('Choose a level');
    expect(text().hasAttribute('data-placeholder')).toBe(true);
    expect(host.model.level().value()).toBe('expert');
  });

  it('shows the label once the option arrives', async () => {
    host.options.set([]);
    await fixture.whenStable();
    expect(text().textContent?.trim()).toBe('Choose a level');

    host.options.set(levels);
    await fixture.whenStable();

    expect(text().textContent?.trim()).toBe('Advanced');
  });

  it('reports touch when the focus leaves it', async () => {
    await open();
    expect(host.model.level().touched()).toBe(false);

    await press('Escape');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).focus();
    await fixture.whenStable();

    expect(host.model.level().touched()).toBe(true);
  });

  it('is described and marked invalid by its field', async () => {
    host.error.set('Choose a level');
    await fixture.whenStable();

    const errorId = trigger().getAttribute('aria-describedby') ?? '';
    expect(trigger().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(errorId)?.textContent?.trim()).toBe('Choose a level');
  });

  it('can be disabled', async () => {
    host.locked.set(true);
    await fixture.whenStable();
    const combobox = await loader.getHarness(ComboboxHarness);

    trigger().click();
    await fixture.whenStable();

    expect(await combobox.isDisabled()).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a custom option template', async () => {
    const templateFixture = TestBed.createComponent(TemplateHostComponent);
    await templateFixture.whenStable();
    const templateTrigger = templateFixture.nativeElement.querySelector('[role="combobox"]') as HTMLElement;

    templateTrigger.focus();
    templateTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await templateFixture.whenStable();

    const rendered = [ ...document.querySelectorAll('.cdk-overlay-container [role="option"] code') ];
    expect(rendered.map(element => element.textContent)).toEqual([ 'simple', 'guided', 'advanced' ]);
  });
});
