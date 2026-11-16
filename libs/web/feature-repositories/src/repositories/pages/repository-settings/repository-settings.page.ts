import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BreadcrumbDirective,
  ButtonComponent,
  InlineBannerComponent,
  PageComponent,
  PageTitleDirective,
  SpinnerComponent
} from '@front-burner/ui';
import { PageTitleService } from '@front-burner/web-core';
import { PageNotFoundPage, RepositoryStatusComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { map, take } from 'rxjs';

import { CloneDetailsComponent } from '../../components/clone-details/clone-details.component';
import { CloneStatusComponent } from '../../components/clone-status/clone-status.component';
import { CredentialsInUseComponent } from '../../components/credentials-in-use/credentials-in-use.component';
import { RepositoryCommitAuthorComponent } from '../../components/repository-commit-author/repository-commit-author.component';
import { RepositoryWarningsComponent } from '../../components/repository-warnings/repository-warnings.component';
import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';

/**
 * The repository settings page at `/repositories/<id>/settings` (RM-9): the
 * breadcrumbs "Repositories › <name> › Settings" (NV-14), the repository's
 * name, status and warnings, remote, **Open** when it is openable, each
 * warning with its fix (RM-8), and its sections in the order of RM-9, each a
 * component that reads `RepositorySettingsStore`. The credential fixes open
 * the **Credentials** section's dialog. A repository that does not exist, or another
 * user's, shows Page not found (RM-1, NV-3).
 *
 * The breadcrumb with the name links to the repository screen when the
 * repository is openable, and to this page otherwise, so that it always leads
 * somewhere useful. The page titles itself "Settings · <name> · Front Burner"
 * (NV-13).
 */
@Component({
  selector: 'repo-repository-settings',
  imports: [
    TranslocoDirective,
    RouterLink,
    PageComponent,
    PageTitleDirective,
    BreadcrumbDirective,
    ButtonComponent,
    InlineBannerComponent,
    SpinnerComponent,
    PageNotFoundPage,
    RepositoryStatusComponent,
    RepositoryWarningsComponent,
    CloneStatusComponent,
    CredentialsInUseComponent,
    RepositoryCommitAuthorComponent,
    CloneDetailsComponent
  ],
  providers: [ RepositorySettingsStore ],
  templateUrl: './repository-settings.page.html',
  styleUrl: './repository-settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositorySettingsPage {
  protected readonly store = inject(RepositorySettingsStore);

  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(params => Number(params.get('id')))), {
    requireSync: true
  });

  protected readonly summary = computed(() => this.store.details()?.summary);
  protected readonly openable = computed(() => this.summary()?.status === 'ready');
  /** Where the name in the breadcrumbs leads: the repository screen, or this page while it cannot be opened. */
  protected readonly nameLink = computed(() =>
    this.openable() ? [ '/repositories', this.id() ] : [ '/repositories', this.id(), 'settings' ]
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.store.load(id));
    });
    this.updateTitle();
    this.focusPageNotFound();
  }

  protected retry(): void {
    this.store.retry();
  }

  /**
   * "Settings · <name> · Front Burner" once the name is known, published so
   * that it is announced (NV-18), and again only when the name changes. Page not
   * found has that page's title, and a failed load publishes the product name
   * alone; until then, the product name is set without announcing it.
   */
  private updateTitle(): void {
    const pageTitle = inject(PageTitleService);
    const transloco = inject(TranslocoService);
    effect(onCleanup => {
      const state = this.store.state();
      const name = this.summary()?.name;
      untracked(() => {
        if (state === 'missing') {
          const pending = transloco.selectTranslate('web-shell.PageNotFoundPage.title').pipe(take(1))
            .subscribe(text => pageTitle.publish(text));
          onCleanup(() => pending.unsubscribe());
        } else if (state === 'failed' && name === undefined) {
          // The product name alone, published so that the page is still announced.
          pageTitle.publish();
        } else if (name === undefined) {
          pageTitle.setPending();
        } else {
          const pending = transloco
            .selectTranslate('web-feature-repositories.RepositorySettingsPage.title', { name })
            .pipe(take(1))
            .subscribe(text => pageTitle.publish(text));
          onCleanup(() => pending.unsubscribe());
        }
      });
    });
  }

  /**
   * Page not found replaces the heading that had the focus after navigation
   * (NV-18), so the focus goes to its heading instead of being lost.
   */
  private focusPageNotFound(): void {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const document = inject(DOCUMENT);
    const injector = inject(Injector);
    effect(() => {
      if (this.store.state() !== 'missing') {
        return;
      }
      afterNextRender(() => {
        if (document.activeElement === document.body) {
          host.querySelector<HTMLElement>('h1')?.focus();
        }
      }, { injector });
    });
  }
}
