import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A line between the items of a `ui-menu`. */
@Component({
  selector: '[uiMenuSeparator]',
  template: '',
  styleUrl: './menu-separator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'separator'
  }
})
export class MenuSeparatorComponent {
}
