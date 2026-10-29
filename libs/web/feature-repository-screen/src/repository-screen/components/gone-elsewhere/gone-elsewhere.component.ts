import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { ApiErrorTextService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The notice above the read-only editor when the open file, which has unsaved
 * edits, was deleted or renamed elsewhere (ED-21, FB-42): "This file was
 * deleted or renamed elsewhere." with **Recreate it**, emitted as `recreate`.
 * After a failed recreate it says why: "A file with this name exists again."
 * for `entry-exists`. Each message is announced politely, without moving the
 * focus (ED-38).
 */
@Component({
  selector: 'rs-gone-elsewhere',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './gone-elsewhere.component.html',
  styleUrl: './gone-elsewhere.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GoneElsewhereComponent {
  private readonly errorText = inject(ApiErrorTextService);

  /** Why the last **Recreate it** failed. */
  readonly error = input<ApiError | null>(null);
  readonly recreate = output<void>();

  protected readonly exists = computed(() => this.error()?.code === 'entry-exists');
  protected readonly failure = computed(() => {
    const error = this.error();
    return error && !this.exists() ? this.errorText.describe(error).text : null;
  });
}
