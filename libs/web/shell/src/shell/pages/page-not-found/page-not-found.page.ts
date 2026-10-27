import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';

/** Every unknown route (NV-3); the app header is there when the user is logged in. */
@Component({
  selector: 'shell-page-not-found',
  imports: [ TranslocoDirective, RouterLink ],
  templateUrl: './page-not-found.page.html',
  styleUrl: './page-not-found.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PageNotFoundPage {}
