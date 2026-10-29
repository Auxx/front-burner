import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ApiErrorTextService, type SaveStatus } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

/** The refusals with their own text (ED-18, ED-19). */
const REFUSALS: Record<string, string> = {
  'file-too-large': 'tooLarge',
  'merge-in-progress': 'mergeInProgress'
};

/**
 * The open file's save status in the repository bar (ED-18, NV-9), in a
 * polite live region, so that each change is announced without moving the
 * focus (ED-38). Empty without an open file.
 */
@Component({
  selector: 'rs-save-status',
  imports: [ TranslocoDirective ],
  templateUrl: './save-status.component.html',
  styleUrl: './save-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite' }
})
export class SaveStatusComponent {
  private readonly errorText = inject(ApiErrorTextService);

  readonly status = input<SaveStatus | null>(null);

  /** The text's key and its parameters. */
  protected readonly text = computed(() => {
    const status = this.status();
    if (status === null) {
      return null;
    }
    switch (status.kind) {
      case 'refused':
        return {
          key: REFUSALS[status.code] ?? 'refused',
          reason: this.errorText.describe({ code: status.code, params: {}, requestId: '', message: status.code }).text
        };
      default:
        return { key: status.kind, reason: '' };
    }
  });
}
