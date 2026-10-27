import { computed, Injectable, type Signal, signal } from '@angular/core';

import type { FailureText, FieldErrorText } from '../../utils/add-repository-errors';

/**
 * The backend's field failures of the last submit (AR-6, AR-42), shown on
 * their fields until the form's inputs change. They are not form errors: an
 * access check can fail for reasons outside the form, such as a key not yet
 * added on the git server, so the same inputs can be submitted again.
 * Provided by the page.
 */
@Injectable()
export class SubmitFailuresService {
  private readonly recorded = signal<{ inputs: string; failures: readonly FailureText[]; } | null>(null);
  private inputs: Signal<string> = signal('');

  private readonly current = computed(() => {
    const recorded = this.recorded();
    return recorded !== null && recorded.inputs === this.inputs() ? recorded.failures : [];
  });

  /** What identifies the form's inputs; a failure is shown while they stay the same. */
  watch(inputs: Signal<string>): void {
    this.inputs = inputs;
  }

  record(failures: readonly FailureText[]): void {
    this.recorded.set({ inputs: this.inputs(), failures });
  }

  clear(): void {
    this.recorded.set(null);
  }

  /** The failure on the field at the API's `path`, if any. */
  forPath(path: string): FieldErrorText | undefined {
    const failure = this.current().find(candidate => candidate.path === path);
    return failure === undefined || failure.key === null ? undefined : { key: failure.key, params: failure.params };
  }
}
