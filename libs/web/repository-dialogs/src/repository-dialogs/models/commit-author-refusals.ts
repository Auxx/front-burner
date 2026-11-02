import { computed, signal } from '@angular/core';
import type { FieldTree } from '@angular/forms/signals';
import type { ApiError, CommitAuthor, FieldError } from '@front-burner/shared-contracts';

const FIELDS = [ 'name', 'email' ] as const satisfies readonly (keyof CommitAuthor)[];

function isFormField(path: string): path is keyof CommitAuthor {
  return (FIELDS as readonly string[]).includes(path);
}

/**
 * The backend's field errors of the last request made with a commit author
 * form, for `CommitAuthorFormComponent`'s `serverErrors`. Each stays until its
 * own field changes.
 */
export class CommitAuthorRefusals {
  private readonly refused = signal<{ value: CommitAuthor; fields: readonly FieldError[]; } | null>(null);

  readonly errors = computed<FieldError[]>(() => {
    const refused = this.refused();
    if (refused === null) {
      return [];
    }
    const value = this.model().value();
    return refused.fields.filter(({ path }) => isFormField(path) && refused.value[path] === value[path]);
  });

  constructor(private readonly model: FieldTree<CommitAuthor>) {}

  /**
   * Keeps the failure's errors on the form's fields. Returns `false` if it has
   * none, so that the caller shows the failure in its own way.
   */
  record(value: CommitAuthor, error: ApiError): boolean {
    const fields = error.fields?.filter(field => isFormField(field.path)) ?? [];
    this.refused.set(fields.length > 0 ? { value, fields } : null);
    return fields.length > 0;
  }

  clear(): void {
    this.refused.set(null);
  }

  /** Focuses the first field with an error, so that a screen reader reads out its reason. */
  focusFirstError(): void {
    const errors = this.errors();
    const first = FIELDS.find(name => errors.some(error => error.path === name) || this.model[name]().invalid());
    if (first !== undefined) {
      this.model[first]().focusBoundControl();
    }
  }
}
