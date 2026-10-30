import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { injectNarrowViewport } from '@front-burner/ui';
import { CurrentUserService } from '@front-burner/web-core';

/** How the editor and the preview share the screen (ED-34). */
export type ViewModeName = 'split' | 'edit' | 'preview';

type Size = 'wide' | 'narrow';

/** The modes of each screen size, the default first (ED-34). */
const MODES: Readonly<Record<Size, readonly ViewModeName[]>> = {
  wide: [ 'split', 'edit', 'preview' ],
  narrow: [ 'edit', 'preview' ]
};

/**
 * The view mode of the repository screen (ED-34): **Split**, **Edit** or
 * **Preview** on wide screens, **Edit** or **Preview** on narrow ones. Each
 * screen size has its own mode, remembered on this device under
 * `fb.<userId>.viewMode.<size>`; a remembered mode that the size does not
 * allow, such as **Split** on a phone, is ignored. When the screen changes
 * size, the mode of the new size applies. Storage that is missing or
 * refuses access only loses the memory.
 */
@Injectable()
export class ViewModeService {
  /** Whether the screen is narrow, which picks the size's mode. */
  readonly narrow = injectNarrowViewport();

  private readonly modes = signal<Record<Size, ViewModeName>>({ wide: 'split', narrow: 'edit' });
  private readonly restoredModes = signal(false);
  private userId: number | undefined;

  readonly mode = computed(() => this.modes()[this.size()]);
  readonly editorShown = computed(() => this.mode() !== 'preview');
  readonly previewShown = computed(() => this.mode() !== 'edit');
  /** Whether this device's remembered modes were read; until then the defaults show. */
  readonly restored = this.restoredModes.asReadonly();

  private readonly size = computed<Size>(() => this.narrow() ? 'narrow' : 'wide');

  constructor() {
    const user = inject(CurrentUserService).user;
    effect(() => {
      const id = user()?.id;
      if (id === undefined || id === this.userId) {
        return;
      }
      this.userId = id;
      untracked(() => {
        const modes = { ...this.modes() };
        for (const size of [ 'wide', 'narrow' ] as const) {
          const remembered = read(id, size);
          if (remembered !== null && MODES[size].includes(remembered as ViewModeName)) {
            modes[size] = remembered as ViewModeName;
          }
        }
        this.modes.set(modes);
        this.restoredModes.set(true);
      });
    });
  }

  /** Switches the current size's mode; one that the size does not allow is ignored. */
  set(mode: ViewModeName): void {
    const size = this.size();
    if (!MODES[size].includes(mode)) {
      return;
    }
    this.modes.update(modes => ({ ...modes, [size]: mode }));
    if (this.userId !== undefined) {
      write(this.userId, size, mode);
    }
  }
}

function read(userId: number, size: Size): string | null {
  try {
    return localStorage.getItem(`fb.${userId}.viewMode.${size}`);
  } catch {
    return null;
  }
}

function write(userId: number, size: Size, mode: ViewModeName): void {
  try {
    localStorage.setItem(`fb.${userId}.viewMode.${size}`, mode);
  } catch {
    // Only the memory is lost.
  }
}
