import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EmptyStateComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The editor area of the repository screen, inside its `main` region labelled
 * "Editor" (NV-17). For now it only says how to start (FB-12).
 */
@Component({
  selector: 'rs-editor-area',
  imports: [ TranslocoDirective, EmptyStateComponent ],
  templateUrl: './editor-area.component.html',
  styleUrl: './editor-area.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorAreaComponent {}
