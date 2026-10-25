import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The actions of a `ui-inline-banner`, such as Unlock or Reload, laid out in a
 * row that wraps: `<div uiBannerActions><button uiButton>Unlock</button></div>`.
 */
@Component({
  selector: '[uiBannerActions]',
  template: '<ng-content />',
  styleUrl: './banner-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BannerActionsComponent {}
