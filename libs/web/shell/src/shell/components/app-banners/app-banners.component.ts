import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { OnlineStatusService, VersionCheckService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The banners that concern the whole web client, directly below the app
 * header, one above the other (NV-15); a page's own notices go below them
 * (NV-16). Each is announced once when it appears (RC-25).
 *
 * - "A new version of Front Burner is available." once the version check
 *   finds another backend version (A-8.7). It cannot be dismissed; **Reload**
 *   sends the waiting saves first (ED-17) and reloads whatever they answer.
 *   It is busy while the reload is under way, and usable again if the browser
 *   stays on the page.
 * - The offline banner while the browser is offline (NF-3.2); it goes away on
 *   its own.
 */
@Component({
  selector: 'shell-app-banners',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './app-banners.component.html',
  styleUrl: './app-banners.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppBannersComponent {
  private readonly versions = inject(VersionCheckService);

  protected readonly newVersion = this.versions.newVersion;
  protected readonly reloading = this.versions.reloading;
  protected readonly online = inject(OnlineStatusService).online;

  protected reload(): void {
    void this.versions.reload();
  }
}
