import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { type ChoiceOption, SegmentedControlComponent, TabComponent, TabStripComponent } from '@front-burner/ui';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { type ViewModeName, ViewModeService } from '../../services/view-mode/view-mode.service';

const KEY = 'web-feature-repository-screen.ViewModeSwitchComponent';

/**
 * The view mode control of the repository screen (ED-34): on wide screens a
 * segmented control labelled "View" with **Split**, **Edit** and
 * **Preview**; on narrow ones **Edit** and **Preview** tabs. The tabs must be
 * inside the `uiTabGroup` that holds the `edit` and `preview` tab panels, so
 * that each tab controls its pane (`aria-controls`).
 */
@Component({
  selector: 'rs-view-mode-switch',
  imports: [ TranslocoDirective, SegmentedControlComponent, TabStripComponent, TabComponent ],
  templateUrl: './view-mode-switch.component.html',
  styleUrl: './view-mode-switch.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ViewModeSwitchComponent {
  protected readonly viewMode = inject(ViewModeService);
  private readonly transloco = inject(TranslocoService);

  protected readonly options = computed<readonly ChoiceOption<ViewModeName>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    return ([ 'split', 'edit', 'preview' ] as const).map(value => ({
      value,
      label: this.transloco.translate(`${KEY}.${value}`)
    }));
  });

  protected select(mode: unknown): void {
    if (mode === 'split' || mode === 'edit' || mode === 'preview') {
      this.viewMode.set(mode);
    }
  }
}
