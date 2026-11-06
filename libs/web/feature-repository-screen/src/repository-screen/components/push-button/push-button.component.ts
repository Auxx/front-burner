import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'rs-push-button',
  imports: [ TranslocoDirective ],
  templateUrl: './push-button.component.html',
  styleUrl: './push-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PushButtonComponent {
}
