import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  confirmsName,
  type RemovalCheckResult,
  RemovalCheckResultSchema,
  wouldLoseWork
} from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  FieldComponent,
  InlineBannerComponent,
  InputComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom, type Subscription } from 'rxjs';

/** The repository that **Remove repository** removes. */
export interface RemoveRepositoryData {
  readonly id: number;
  readonly name: string;
}

/** One line of the list of what removing would lose, as its message key and parameters. */
interface Loss {
  readonly key: string;
  readonly params: Record<string, number>;
}

let nextId = 0;

/**
 * Asks before removing a repository (RM-17, RM-18): "Remove <name>? This
 * deletes its working copy on Front Burner. The remote is not changed." It
 * reads `GET /repositories/:id/removal` when it opens; **Remove** is offered
 * once that answer is there, and a failure shows the error with **Try again**.
 *
 * With nothing to lose, one click on **Remove** removes. With work to lose,
 * the dialog lists it (uncommitted files, commits not pushed, stashes, a merge
 * in progress, or a working copy that git can't read) and asks for the
 * repository name: **Remove** is enabled once the field matches, as the
 * backend compares it (`confirmsName`), and the name is sent as `confirmName`.
 * Work that appeared after the dialog opened makes the backend answer `409
 * removal-needs-confirmation` with the new check, which turns the dialog into
 * its typed-name form instead of failing (RM-18's check on confirming): a
 * warning announces it, and the focus moves to the name field.
 *
 * **Cancel** has the focus first, as removing is the dangerous choice (NF-13).
 * The dialog closes with `true` once the repository is removed, also when it
 * turns out to be gone already, such as when another tab removed it; any other
 * failure keeps it open with the error.
 */
@Component({
  selector: 'repo-remove-repository-dialog',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent,
    FieldComponent,
    InlineBannerComponent,
    InputComponent,
    SpinnerComponent
  ],
  templateUrl: './remove-repository.dialog.html',
  styleUrl: './remove-repository.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RemoveRepositoryDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as RemoveRepositoryData;
  private readonly api = inject(RepositoriesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly destroyRef = inject(DestroyRef);
  private checkRequest: Subscription | undefined;

  protected readonly formId = `repo-remove-repository-form-${nextId++}`;

  /** What removing would lose, once the backend answered. */
  protected readonly check = signal<RemovalCheckResult | null>(null);
  /** Why the check could not be had; **Try again** asks again. */
  protected readonly checkFailure = signal<ApiErrorText | null>(null);
  /** Why the last **Remove** did not remove. */
  protected readonly failure = signal<ApiErrorText | null>(null);
  protected readonly busy = signal(false);
  /** What the user typed in the name field. */
  protected readonly typed = signal('');
  /** Whether work appeared after the dialog opened, which the dialog announces (NF-13). */
  protected readonly appeared = signal(false);

  private readonly injector = inject(Injector);
  private readonly nameInput = viewChild(InputComponent);

  /** Whether the user must type the name (RM-18). */
  protected readonly needsName = computed(() => {
    const check = this.check();
    return check !== null && wouldLoseWork(check);
  });
  /** Whether git could not read the working copy, which the dialog says instead of the list. */
  protected readonly unreadable = computed(() => this.check()?.unreadable === true);
  /** The list of what would be lost. */
  protected readonly losses = computed<Loss[]>(() => {
    const check = this.check();
    if (check === null) {
      return [];
    }
    const counted: Loss[] = [
      { key: 'uncommitted', params: { count: check.uncommittedFiles } },
      { key: 'unpushed', params: { count: check.unpushedCommits } },
      { key: 'stashes', params: { count: check.stashes } }
    ];
    return [
      ...counted.filter(loss => loss.params['count'] > 0),
      ...(check.mergeInProgress ? [ { key: 'merge', params: {} } ] : [])
    ];
  });
  /** Whether **Remove** can be pressed: the check is there, and the name is typed when it is needed. */
  protected readonly canRemove = computed(() =>
    this.check() !== null && (!this.needsName() || confirmsName(this.data.name, this.typed()))
  );

  constructor() {
    this.loadCheck();
  }

  protected loadCheck(): void {
    this.checkFailure.set(null);
    this.checkRequest?.unsubscribe();
    this.checkRequest = this.api
      .removalCheck(this.data.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: check => this.check.set(check),
        error: (error: unknown) => {
          const apiError = toApiError(error);
          if (apiError.code === 'not-found') {
            this.ref.close(true);
          } else {
            this.checkFailure.set(this.errorText.describe(apiError));
          }
        }
      });
  }

  protected type(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  protected async remove(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.busy() || !this.canRemove()) {
      return;
    }
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      const query = this.needsName() ? { confirmName: this.typed() } : undefined;
      await firstValueFrom(this.api.remove(this.data.id, query), { defaultValue: undefined });
      this.ref.close(true);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'not-found') {
        this.ref.close(true);
        return;
      }
      const check = apiError.code === 'removal-needs-confirmation'
        ? RemovalCheckResultSchema.safeParse(apiError.params)
        : null;
      if (check?.success) {
        // Work appeared since the dialog opened: ask for the name with the new counts, saying so, and
        // move the focus off Remove, which is unavailable now, to the field that makes it available.
        this.check.set(check.data);
        this.appeared.set(true);
        afterNextRender(() => this.nameInput()?.focus(), { injector: this.injector });
      } else {
        this.failure.set(this.errorText.describe(apiError));
      }
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
