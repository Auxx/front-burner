import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The question above the editor when the open file changed on disk while it
 * had unsaved edits (ED-24): "This file changed while you were editing.",
 * with **Reload** and **Keep mine**, emitted as `reload` and `keepMine`.
 * Announced politely, without moving the focus (ED-38).
 */
@Component({
  selector: 'rs-changed-on-disk',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './changed-on-disk.component.html',
  styleUrl: './changed-on-disk.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChangedOnDiskComponent {
  readonly reload = output<void>();
  readonly keepMine = output<void>();
}
