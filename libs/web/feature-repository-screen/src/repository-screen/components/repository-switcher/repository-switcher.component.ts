import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import {
  MenuComponent,
  MenuGroupDirective,
  MenuItemComponent,
  MenuSeparatorComponent,
  MenuTriggerDirective,
  TooltipDirective
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { RepositoryStatusComponent } from '@front-burner/web-shell';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';

type OtherRepositories =
  | { kind: 'loading'; }
  | { kind: 'failed'; }
  | { kind: 'loaded'; repositories: readonly RepositorySummary[]; };

/**
 * The repository name in the bar, which opens the repository switcher (NV-10):
 * up to 10 of the user's other repositories in the dashboard's order, each
 * with its status, then **All repositories** and **Repository settings**, and
 * on narrow screens **Dashboard** first (NV-11). The list comes from the
 * dashboard's API call and is loaded each time the menu opens; when it fails,
 * the links stay and **Try again** loads it again. A ready repository opens in
 * the editor, a cloning or failed one opens its settings, as on the dashboard
 * (DS-22). On narrow screens the name is shortened and its full name is in a
 * tooltip (NV-11).
 */
@Component({
  selector: 'rs-repository-switcher',
  imports: [
    TranslocoDirective,
    RouterLink,
    MenuComponent,
    MenuGroupDirective,
    MenuItemComponent,
    MenuSeparatorComponent,
    MenuTriggerDirective,
    TooltipDirective,
    RepositoryStatusComponent
  ],
  templateUrl: './repository-switcher.component.html',
  styleUrl: './repository-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositorySwitcherComponent {
  readonly repository = input.required<RepositorySummary>();
  /** Whether the screen uses its narrow layout. */
  readonly narrow = input(false);

  private readonly api = inject(RepositoriesApi);
  // In the translated view, which renders once the texts have loaded.
  private readonly menu = viewChild(MenuComponent);
  private readonly trigger = viewChild(MenuTriggerDirective);
  private readonly menuElement = viewChild(MenuComponent, { read: ElementRef<HTMLElement> });
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private loading?: Subscription;

  protected readonly others = signal<OtherRepositories>({ kind: 'loading' });

  constructor() {
    effect(() => {
      if (this.menu()?.aria.visible()) {
        untracked(() => this.load());
      }
    });
    inject(DestroyRef).onDestroy(() => this.loading?.unsubscribe());
  }

  protected selected(value: unknown): void {
    if (value === 'retry') {
      // Choosing an item closed the menu; it opens again on the new list.
      this.load();
      this.trigger()?.open();
    }
  }

  private load(): void {
    this.loading?.unsubscribe();
    this.others.set({ kind: 'loading' });
    this.loading = this.api.recent({ exclude: this.repository().id }).subscribe({
      next: ({ repositories }) => this.show({ kind: 'loaded', repositories }),
      error: () => this.show({ kind: 'failed' })
    });
  }

  private show(others: OtherRepositories): void {
    this.others.set(others);
    // While loading, the menu opened on its first link. Unless the user has
    // moved on, the focus goes to the first item now above it.
    afterNextRender(() => {
      const menu = this.menuElement()?.nativeElement;
      const focused = this.document.activeElement;
      if (
        this.menu()?.aria.visible() && menu
        && (!menu.contains(focused) || focused === menu.querySelector('.link'))
      ) {
        this.trigger()?.open();
      }
    }, { injector: this.injector });
  }
}
