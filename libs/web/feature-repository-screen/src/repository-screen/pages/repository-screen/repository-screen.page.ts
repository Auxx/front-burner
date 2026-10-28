import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AppShellComponent, ButtonComponent, InlineBannerComponent, SpinnerComponent } from '@front-burner/ui';
import { CurrentUserService } from '@front-burner/web-core';
import { AppHeaderComponent, PageNotFoundPage, RouteAnnouncerComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { map, take } from 'rxjs';

import { NotOpenableComponent } from '../../components/not-openable/not-openable.component';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';

/** The product name is not translated. */
const PRODUCT_NAME = 'Front Burner';

/**
 * The repository screen (REQ-FILE-001) at `/repositories/<id>` and
 * `/repositories/<id>/files/<path>`. The page stays when only the file in the
 * route changes, so the repository is opened once per visit (FB-11). Nothing
 * of the screen shows until the repository has opened; one that is not the
 * user's, or does not exist, shows Page not found (FB-2).
 */
@Component({
  selector: 'rs-repository-screen',
  imports: [
    TranslocoDirective,
    AppShellComponent,
    ButtonComponent,
    InlineBannerComponent,
    SpinnerComponent,
    AppHeaderComponent,
    PageNotFoundPage,
    RouteAnnouncerComponent,
    NotOpenableComponent
  ],
  providers: [ RepositorySessionService ],
  templateUrl: './repository-screen.page.html',
  styleUrl: './repository-screen.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryScreenPage {
  protected readonly session = inject(RepositorySessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly currentUser = inject(CurrentUserService);

  protected readonly user = this.currentUser.user;
  /** The open file's path in the working copy, or `''` (FB-1). */
  protected readonly path = toSignal(this.route.paramMap.pipe(map(params => params.get('path') ?? '')), {
    requireSync: true
  });

  constructor() {
    this.route.paramMap
      .pipe(map(params => Number(params.get('id'))), takeUntilDestroyed())
      .subscribe(id => this.session.start(id));
    // The app header's loader is not on this screen (NV-9).
    this.currentUser.load().catch(() => undefined);
    this.updateTitle();
  }

  /** `<repository name> · Front Burner` (NV-13); the route leaves the title to the page. */
  private updateTitle(): void {
    const title = inject(Title);
    const transloco = inject(TranslocoService);
    effect(onCleanup => {
      const repository = this.session.repository();
      if (this.session.state() === 'missing') {
        const pending = transloco.selectTranslate('web-shell.PageNotFoundPage.title').pipe(take(1)).subscribe(text => {
          title.setTitle(`${text} · ${PRODUCT_NAME}`);
        });
        onCleanup(() => pending.unsubscribe());
      } else if (repository) {
        title.setTitle(`${repository.name} · ${PRODUCT_NAME}`);
      }
    });
  }
}
