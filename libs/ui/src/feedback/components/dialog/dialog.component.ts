import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { DialogRef } from '../../services/dialog/dialog-ref';
import { DIALOG_CONTEXT } from '../../services/dialog/dialog.model';

/** The element that gets the focus when a dialog opens, in order of preference. */
const INITIAL_FOCUS = [
  '[data-autofocus]',
  '.body :is(input, textarea, select, [role="combobox"]):not(:disabled)'
];

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The frame of a dialog opened with `DialogService`: its heading, its content,
 * and a footer of buttons marked `uiDialogFooter`. With a `closeLabel` it has
 * a close button, which closes the dialog with no result.
 *
 * When it opens, it focuses an element marked `data-autofocus` (lint rules
 * forbid the native `autofocus`), else the first field of its content,
 * else the dialog itself (RC-25). Content that overflows scrolls, and is a tab
 * stop while it has nothing focusable, so that the keyboard can scroll it.
 */
@Component({
  selector: 'ui-dialog',
  imports: [ IconButtonComponent, IconComponent ],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'context.size'
  }
})
export class DialogComponent {
  readonly heading = input.required<string>();
  readonly closeLabel = input<string>();

  protected readonly ref = inject(DialogRef);
  protected readonly context = inject(DIALOG_CONTEXT);

  /** Whether the content overflows with nothing focusable to scroll it by. */
  protected readonly scrollableByKeyboard = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const body = this.body().nativeElement;
      const update = () =>
        this.scrollableByKeyboard.set(
          body.scrollHeight > body.clientHeight && !body.querySelector(FOCUSABLE)
        );
      update();
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(update);
        observer.observe(body);
        destroyRef.onDestroy(() => observer.disconnect());
      }
    });
    afterNextRender(() => {
      const target = INITIAL_FOCUS.map(selector => this.host.querySelector<HTMLElement>(selector)).find(Boolean)
        ?? this.host.closest<HTMLElement>('[role="dialog"]');
      target?.focus();
    });
  }
}
