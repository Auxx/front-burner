import { effect, inject, Injectable, signal, untracked, type WritableSignal } from '@angular/core';
import { CurrentUserService } from '@front-burner/web-core';

/**
 * The editor's settings for the repository screen. One setting for the whole
 * screen, shared by every file, that lasts until the page is reloaded, also
 * when the user leaves the repository screen and comes back. It starts again
 * when another user signs in. It will be backed by the user preference later
 * (ED-10).
 */
@Injectable({ providedIn: 'root' })
export class EditorSettingsService {
  /** Whether long lines wrap; on by default. */
  readonly softWrap: WritableSignal<boolean> = signal(true);

  private userId: number | undefined;

  constructor() {
    const user = inject(CurrentUserService).user;
    effect(() => {
      const id = user()?.id;
      if (id === undefined || id === this.userId) {
        return;
      }
      const changed = this.userId !== undefined;
      this.userId = id;
      if (changed) {
        untracked(() => this.softWrap.set(true));
      }
    });
  }
}
