import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { CurrentUserService } from '@front-burner/web-core';

const DEFAULT_SIDE_SIZE = 20;

/** The tool windows of the side pane (GA-10). */
export type SideTool = 'files' | 'changes';

/**
 * The repository screen's panes as this device last left them (FB-8): the side
 * pane's share of the width and whether it is collapsed, under
 * `fb.<userId>.repositoryScreen.<key>`. Read once the user is known, then
 * written back on every change, and which tool window is selected, under
 * `fb.<userId>.sideTool`. Storage that is missing or refuses access only loses
 * the memory.
 */
@Injectable()
export class PaneMemoryService {
  /** The side pane's share of the width, in percent. */
  readonly sideSize = signal(DEFAULT_SIDE_SIZE);
  /** Whether the side pane is beside the editor on wide screens. */
  readonly sideOpen = signal(true);
  /** The tool window in the side pane, also while the pane is collapsed. */
  readonly sideTool = signal<SideTool>('files');

  constructor() {
    const user = inject(CurrentUserService).user;
    let userId: number | undefined;

    effect(() => {
      const id = user()?.id;
      if (id === undefined || id === userId) {
        return;
      }
      userId = id;
      untracked(() => {
        const size = Number(readItem(`fb.${id}.repositoryScreen.sideSize`) ?? Number.NaN);
        if (Number.isFinite(size) && size > 0 && size < 100) {
          this.sideSize.set(size);
        }
        const open = readItem(`fb.${id}.repositoryScreen.sideOpen`);
        if (open === 'true' || open === 'false') {
          this.sideOpen.set(open === 'true');
        }
        const tool = readItem(`fb.${id}.sideTool`);
        if (tool === 'files' || tool === 'changes') {
          this.sideTool.set(tool);
        }
      });
    });

    effect(() => {
      const size = this.sideSize();
      const open = this.sideOpen();
      const tool = this.sideTool();
      if (userId !== undefined) {
        writeItem(`fb.${userId}.repositoryScreen.sideSize`, String(size));
        writeItem(`fb.${userId}.repositoryScreen.sideOpen`, String(open));
        writeItem(`fb.${userId}.sideTool`, tool);
      }
    });
  }
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only the memory is lost.
  }
}
