import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The quiet note above the editor for a large file opened on a narrow screen
 * without highlighting, with **Turn on highlighting**, emitted as `turnOn`
 * (ED-9a).
 */
@Component({
  selector: 'rs-large-file-note',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './large-file-note.component.html',
  styleUrl: './large-file-note.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LargeFileNoteComponent {
  readonly turnOn = output<void>();
}
