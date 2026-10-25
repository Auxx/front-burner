import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  untracked
} from '@angular/core';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { ToastService } from '../../services/toast/toast.service';
import { StatusIconComponent } from '../status-icon/status-icon.component';

// Codicon `close` (CC-BY-4.0), inline until the Icon component exists.
const close =
  'M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z';

/**
 * Where the toasts of `ToastService` are shown: a labelled region that the web
 * client places once, in its app shell. It never takes the focus. When the
 * toast that holds the focus goes away, the focus returns to where it was
 * before it entered the region, or else to the next toast.
 *
 * The app shell sets `--ui-toast-offset-block-end` to keep the toasts above
 * its status bar.
 */
@Component({
  selector: 'ui-toast-outlet',
  imports: [ ButtonComponent, IconButtonComponent, StatusIconComponent ],
  templateUrl: './toast-outlet.component.html',
  styleUrl: './toast-outlet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    '[attr.aria-label]': 'label()',
    '(focusin)': 'onFocusin($event)'
  }
})
export class ToastOutletComponent {
  readonly label = input.required<string>();

  protected readonly service = inject(ToastService);
  protected readonly close = close;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  /** Where the focus was before it entered the region. */
  private returnTo: HTMLElement | null = null;
  /** The toast that holds the focus. */
  private focusedToast: string | null = null;

  constructor() {
    effect(() => {
      const ids = this.service.toasts().map(toast => toast.id);
      untracked(() => {
        if (this.focusedToast && !ids.includes(this.focusedToast)) {
          this.focusedToast = null;
          afterNextRender(() => this.restoreFocus(), { injector: this.injector });
        }
      });
    });
  }

  protected onFocusin(event: FocusEvent): void {
    const from = event.relatedTarget as HTMLElement | null;
    if (from && !this.host.contains(from)) {
      this.returnTo = from;
    }
  }

  protected onToastFocusin(id: string): void {
    this.focusedToast = id;
    this.service.pause(id);
  }

  protected onToastFocusout(event: FocusEvent, id: string): void {
    const toast = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    // No next target: the focused element may have been removed with its
    // toast, which the effect above handles.
    if (next && !toast.contains(next)) {
      this.focusedToast = null;
      this.service.resume(id);
    }
  }

  private restoreFocus(): void {
    const active = this.host.ownerDocument.activeElement;
    if (active && active !== this.host.ownerDocument.body && !this.host.contains(active)) {
      return;
    }
    if (this.returnTo?.isConnected) {
      this.returnTo.focus();
    } else {
      this.host.querySelector<HTMLElement>('.dismiss')?.focus();
    }
  }
}
