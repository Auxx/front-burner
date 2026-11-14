import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, untracked } from '@angular/core';
import { ButtonComponent } from '@front-burner/ui';
import {
  conflictAtCursor,
  type ConflictChoice,
  conflictsIn,
  type EditorStateChange
} from '@front-burner/web-code-editor';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

type EditorState = EditorStateChange['state'];

/** An **Accept** of the bar: the conflict at the cursor, and the version chosen. */
export interface ConflictAccept {
  index: number;
  choice: ConflictChoice;
}

const KEY = 'web-feature-repository-screen.ConflictBarComponent';

/**
 * The bar above the editor of a conflicting file (GC-10, GC-11, GC-28): which
 * conflict has the cursor, "Conflict 2 of 5", or how many there are, "5
 * conflicts", or "No conflict markers left."; **Previous** and **Next**, which go
 * to the conflict before and after the one at the cursor, or the nearest ones
 * when the cursor is in none; and **Accept mine**, **Accept theirs** and
 * **Accept both** for the conflict at the cursor, unavailable while the editor
 * is read-only, as the buttons inside it are.
 *
 * It gives the keyboard and screen readers what the buttons inside the editor
 * give to pointer and touch, since those can't be reached with `Tab`. It reads
 * the conflicts from the editor's state and changes nothing itself: a move and
 * an accept are emitted, for the editor pane to carry out. Each move is announced
 * as "Conflict 2 of 5: mine and theirs", and a change of the count politely.
 */
@Component({
  selector: 'rs-conflict-bar',
  imports: [ TranslocoDirective, ButtonComponent ],
  templateUrl: './conflict-bar.component.html',
  styleUrl: './conflict-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConflictBarComponent {
  private readonly announcer = inject(LiveAnnouncer);
  private readonly transloco = inject(TranslocoService);

  /** The editor's state, whose conflicts the bar shows. */
  readonly state = input.required<EditorState>();
  /** **Previous** or **Next**: the index of the conflict to move the cursor to. */
  readonly move = output<number>();
  /** **Accept mine**, **Accept theirs** or **Accept both** for the conflict at the cursor. */
  readonly accept = output<ConflictAccept>();

  protected readonly regions = computed(() => conflictsIn(this.state()));
  /** The index of the conflict at the cursor, or `null`. */
  protected readonly at = computed(() => conflictAtCursor(this.state()));
  protected readonly total = computed(() => this.regions().length);
  /** Whether **Accept** can act: on a conflict at the cursor, in an editor that can be edited. */
  protected readonly acceptable = computed(() => this.at() !== null && !this.state().readOnly);
  /** The conflict that **Previous** goes to: the one before the cursor's, or the nearest before the cursor. */
  protected readonly previous = computed(() => {
    const at = this.at();
    if (at !== null) {
      return at > 0 ? at - 1 : null;
    }
    const head = this.state().selection.main.head;
    const index = this.regions().findLastIndex(region => region.to < head);
    return index < 0 ? null : index;
  });
  /** The conflict that **Next** goes to: the one after the cursor's, or the nearest after the cursor. */
  protected readonly next = computed(() => {
    const at = this.at();
    if (at !== null) {
      return at < this.total() - 1 ? at + 1 : null;
    }
    const head = this.state().selection.main.head;
    const index = this.regions().findIndex(region => region.from > head);
    return index < 0 ? null : index;
  });
  /** What the bar says, as a translation key and its parameters. */
  protected readonly position = computed(() => {
    const at = this.at();
    const total = this.total();
    if (at !== null) {
      return { key: 'at', params: { index: at + 1, total } };
    }
    return total > 0 ? { key: 'count', params: { count: total } } : { key: 'none', params: {} };
  });

  constructor() {
    // The count is announced when it changes, not when the bar first shows it.
    let known: number | null = null;
    effect(() => {
      const total = this.total();
      untracked(() => {
        if (known !== null && known !== total) {
          this.announce(total > 0 ? 'count' : 'none', { count: total });
        }
        known = total;
      });
    });
  }

  protected goTo(index: number | null): void {
    if (index === null) {
      return;
    }
    this.move.emit(index);
    this.announce('moved', { index: index + 1, total: this.total() });
  }

  protected acceptAt(choice: ConflictChoice): void {
    const index = this.at();
    if (index !== null && this.acceptable()) {
      this.accept.emit({ index, choice });
    }
  }

  private announce(key: string, params: Record<string, number>): void {
    void this.announcer.announce(this.transloco.translate(`${KEY}.${key}`, params), 'polite');
  }
}
