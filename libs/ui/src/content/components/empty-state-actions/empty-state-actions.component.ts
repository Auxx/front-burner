import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The actions of a `ui-empty-state`, such as New file or Add repository,
 * centred in a row that wraps: `<div uiEmptyStateActions><button uiButton>New
 * file</button></div>`.
 */
@Component({
  selector: '[uiEmptyStateActions]',
  template: '<ng-content />',
  styleUrl: './empty-state-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmptyStateActionsComponent {}
