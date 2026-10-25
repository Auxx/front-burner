import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { disabled, form, FormField } from '@angular/forms/signals';

import { type ChoiceOption } from '../../models/choice-option.model';
import { SegmentedControlComponent } from './segmented-control.component';

@Component({
  imports: [ FormField, SegmentedControlComponent ],
  template: `
    <ui-segmented-control label="Credentials" [options]="options()" [formField]="model.credentials" (touch)="touches = touches + 1" />
    <button>Next</button>
  `
})
class HostComponent {
  touches = 0;
  readonly locked = signal(false);
  readonly options = signal<readonly ChoiceOption<string>[]>([
    { value: 'saved', label: 'Use saved credentials' },
    { value: 'new', label: 'Add new credentials' },
    { value: 'none', label: 'No credentials (public repository)' }
  ]);
  readonly model = form(signal({ credentials: 'saved' }), path => {
    disabled(path.credentials, () => this.locked());
  });
}

describe('SegmentedControlComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const group = () => fixture.nativeElement.querySelector('ui-segmented-control') as HTMLElement;
  const radios = () => [ ...group().querySelectorAll('input[type="radio"]') ] as HTMLInputElement[];
  const radio = (label: string) =>
    radios().find(input => input.closest('label')?.textContent?.trim() === label) as HTMLInputElement;
  const next = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('is a labelled radio group of its options', () => {
    expect(group().getAttribute('role')).toBe('radiogroup');
    expect(group().getAttribute('aria-label')).toBe('Credentials');
    expect(radios().length).toBe(3);
    expect(new Set(radios().map(input => input.name)).size).toBe(1);
    expect(radios()[0].name).not.toBe('');
    expect(radio('Add new credentials')).toBeTruthy();
  });

  it('checks the option with the current value', () => {
    expect(radios().map(input => input.checked)).toEqual([ true, false, false ]);
  });

  it('updates the value on change', async () => {
    radio('Add new credentials').click();
    await fixture.whenStable();

    expect(host.model.credentials().value()).toBe('new');
    expect(radio('Add new credentials').checked).toBe(true);
  });

  it('checks nothing for a value that is not an option', async () => {
    host.model.credentials().value.set('other');
    await fixture.whenStable();

    expect(radios().every(input => !input.checked)).toBe(true);
  });

  it('reports touch when the focus leaves it', async () => {
    radio('Use saved credentials').focus();
    radio('Add new credentials').focus();
    expect(host.touches).toBe(0);

    next().focus();
    await fixture.whenStable();

    expect(host.touches).toBe(1);
    expect(host.model.credentials().touched()).toBe(true);
  });

  it('disables every option with the field', async () => {
    host.locked.set(true);
    await fixture.whenStable();

    expect(radios().every(input => input.disabled)).toBe(true);
  });

  it('disables one option', async () => {
    host.options.update(options => options.map(option => ({ ...option, disabled: option.value === 'none' })));
    await fixture.whenStable();

    expect(radios().map(input => input.disabled)).toEqual([ false, false, true ]);
  });
});
