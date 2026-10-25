import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastOutletComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'app-root',
  imports: [ RouterOutlet, ToastOutletComponent, TranslocoDirective ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {}
