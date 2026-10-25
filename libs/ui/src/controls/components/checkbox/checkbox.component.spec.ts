import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, required } from '@angular/forms/signals';

import { ChoiceComponent } from '../choice/choice.component';
import { CheckboxComponent } from './checkbox.component';

@Component({
  imports: [ CheckboxComponent, ChoiceComponent, FormField ],
  template: `
    <label uiChoice><input type="checkbox" uiCheckbox [indeterminate]="mixed()" (change)="mixed.set(false)" /> All files</label>
    <label uiChoice><input type="checkbox" uiCheckbox [formField]="model.understood" /> I understand</label>
    <label uiChoice><input type="checkbox" uiCheckbox disabled /> Amend last commit</label>
  `
})
class HostComponent {
  readonly model = form(signal({ understood: false }), path => {
    required(path.understood);
  });
  readonly mixed = signal(true);
}

describe('CheckboxComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const label = (index: number) => fixture.nativeElement.querySelectorAll('label')[index] as HTMLLabelElement;
  const checkbox = (index: number) => label(index).querySelector('input') as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('is a native checkbox named by its label', () => {
    expect(checkbox(1).type).toBe('checkbox');
    expect(label(1).control).toBe(checkbox(1));
    expect(label(1).textContent?.trim()).toBe('I understand');
  });

  it('shows the mixed state', () => {
    expect(checkbox(0).indeterminate).toBe(true);
    expect(checkbox(0).matches(':indeterminate')).toBe(true);
  });

  it('ticks and leaves the mixed state on click', async () => {
    checkbox(0).click();
    await fixture.whenStable();

    expect(checkbox(0).checked).toBe(true);
    expect(checkbox(0).indeterminate).toBe(false);
    expect(host.mixed()).toBe(false);
  });

  it('binds to a Signal Forms field', async () => {
    checkbox(1).click();
    await fixture.whenStable();

    expect(host.model.understood().value()).toBe(true);
    expect(checkbox(1).required).toBe(true);
  });

  it('toggles from its label text', async () => {
    label(1).click();
    await fixture.whenStable();

    expect(checkbox(1).checked).toBe(true);
  });

  it('keeps the native disabled state', () => {
    label(2).click();

    expect(checkbox(2).disabled).toBe(true);
    expect(checkbox(2).checked).toBe(false);
  });
});
