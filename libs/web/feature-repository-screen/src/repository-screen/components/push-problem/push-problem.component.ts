import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'rs-push-problem',
  imports: [ TranslocoDirective ],
  templateUrl: './push-problem.component.html',
  styleUrl: './push-problem.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PushProblemComponent {
}
