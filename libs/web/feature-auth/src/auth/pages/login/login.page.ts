import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

import { EmptyStateComponent } from '@front-burner/ui';

@Component({
  selector: 'auth-login',
  imports: [ TranslocoDirective, EmptyStateComponent ],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPage {
}
