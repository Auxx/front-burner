import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'rs-repository-screen',
  imports: [ TranslocoDirective ],
  templateUrl: './repository-screen.page.html',
  styleUrl: './repository-screen.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryScreenPage {
}
