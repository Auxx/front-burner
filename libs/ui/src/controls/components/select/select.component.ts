import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option } from '@angular/aria/listbox';
import { CdkConnectedOverlay, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgTemplateOutlet } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  effect,
  type ElementRef,
  forwardRef,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { SelectOptionDirective } from '../../directives/select-option/select-option.directive';
import { type ChoiceOption } from '../../models/choice-option.model';
import { FieldControl } from '../../models/field-control.model';

let nextId = 0;

/**
 * A drop-down list of options to choose one from, built on Angular Aria's
 * Combobox and Listbox: the focus stays on the trigger, the arrow keys move
 * through the options, Enter or a click chooses one and Escape closes the
 * list. The list is in an overlay below or above the trigger.
 *
 * Options are compared with `===`. A value that is not among the options, for
 * example while they are loading, shows the placeholder and is kept.
 *
 * It has the shape of Signal Forms' `FormValueControl` (`value`, `disabled`,
 * `touch`), so it can be bound with `[formField]` as well as `[(value)]`. Put
 * it in a `ui-field` for its label, or give it an `aria-label`, which names the
 * combobox.
 *
 * With a `uiSelectOption` template, the template's text is each option's
 * accessible name, as it is what the option shows.
 */
@Component({
  selector: 'ui-select',
  imports: [
    CdkConnectedOverlay,
    Combobox,
    ComboboxPopup,
    ComboboxWidget,
    IconComponent,
    Listbox,
    NgTemplateOutlet,
    Option
  ],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-label]': 'null'
  },
  providers: [ { provide: FieldControl, useExisting: forwardRef(() => SelectComponent) } ]
})
export class SelectComponent<V> extends FieldControl {
  readonly options = input.required<readonly ChoiceOption<V>[]>();
  readonly value = model<V | undefined>(undefined);
  /** Shown when no option has the value, such as "Loading branches…". */
  readonly placeholder = input('');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly id = input<string>(`ui-select-${nextId++}`);
  /** The name outside a `ui-field`; it goes on the combobox, not the host. */
  readonly ariaLabel = input<string | undefined>(undefined, { alias: 'aria-label' });

  /** Emitted when the focus leaves the control. */
  readonly touch = output<void>();

  readonly labelable = false;

  protected readonly expanded = signal(false);
  protected readonly optionTemplate = contentChild(SelectOptionDirective<V>);
  protected readonly selected = computed(() => this.options().find(option => option.value === this.value()));
  protected readonly selectedValues = computed(() => {
    const selected = this.selected();
    return selected ? [ selected.value ] : [];
  });

  /** The list is at least as wide as the trigger. */
  protected readonly triggerWidth = signal(0);
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 }
  ];

  private readonly combobox = viewChild.required(Combobox);
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    super();
    effect(() => {
      if (this.expanded()) {
        untracked(() => this.triggerWidth.set(this.trigger().nativeElement.getBoundingClientRect().width));
      }
    });
  }

  focus(): void {
    this.trigger().nativeElement.focus();
  }

  protected choose(values: V[]): void {
    if (values.length > 0) {
      this.value.set(values[0]);
    }
    this.expanded.set(false);
    this.focus();
  }

  protected onBlur(event: FocusEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!(event.relatedTarget instanceof Node && panel?.contains(event.relatedTarget))) {
      // Aria closes the list a task later, which would emit from a destroyed
      // combobox (NG0953) if the select is removed meanwhile.
      this.combobox().expanded.set(false);
      this.touch.emit();
    }
  }
}
