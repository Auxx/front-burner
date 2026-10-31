import { Injectable, signal, type WritableSignal } from '@angular/core';

/**
 * The editor's settings for the repository screen. One setting for the whole
 * screen, shared by every file, that lasts until the page is reloaded; it will
 * be backed by the user preference later (ED-10).
 */
@Injectable()
export class EditorSettingsService {
  /** Whether long lines wrap; on by default. */
  readonly softWrap: WritableSignal<boolean> = signal(true);
}
