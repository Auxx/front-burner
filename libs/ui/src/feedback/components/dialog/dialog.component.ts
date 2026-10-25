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

import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { DialogRef } from '../../services/dialog/dialog-ref';
import { DIALOG_CONTEXT } from '../../services/dialog/dialog.model';

// Codicon `close` (CC-BY-4.0), inline until the Icon component exists.
const close =
  'M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z';

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
  imports: [ IconButtonComponent ],
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
  protected readonly close = close;

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
