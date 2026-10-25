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

import { IconComponent } from '../../../content/components/icon/icon.component';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { type ToastAction } from '../../services/toast/toast.model';
import { ToastService } from '../../services/toast/toast.service';
import { StatusIconComponent } from '../status-icon/status-icon.component';

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
  imports: [ ButtonComponent, IconButtonComponent, IconComponent, StatusIconComponent ],
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
    this.service.pause(id, 'focus');
  }

  protected onToastFocusout(event: FocusEvent, id: string): void {
    const toast = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    // No next target: the focused element may have been removed with its
    // toast, which the effect above handles.
    if (next && !toast.contains(next)) {
      this.focusedToast = null;
      this.service.resume(id, 'focus');
    }
  }

  /**
   * Moves the focus out of the toast first: an action that opens a dialog
   * would otherwise return the focus, when the dialog closes, to a button
   * that is gone.
   */
  protected runAction(id: string, action: ToastAction): void {
    if (this.host.contains(this.host.ownerDocument.activeElement)) {
      this.focusedToast = null;
      this.restoreFocus(id);
    }
    this.service.run(id, action);
  }

  /** Focuses where the focus was before the region, else another toast than `leaving`. */
  private restoreFocus(leaving?: string): void {
    const active = this.host.ownerDocument.activeElement;
    if (active && active !== this.host.ownerDocument.body && !this.host.contains(active)) {
      return;
    }
    if (this.returnTo?.isConnected) {
      this.returnTo.focus();
    } else {
      const others = leaving ? `.toast:not([data-toast="${leaving}"])` : '.toast';
      this.host.querySelector<HTMLElement>(`${others} .dismiss`)?.focus();
    }
  }
}
