import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type FieldTree, FormField, type ValidationError } from '@angular/forms/signals';
import { COMMIT_AUTHOR_FIELD_CODES, type CommitAuthor, type FieldError } from '@front-burner/shared-contracts';
import { FieldComponent, InputComponent } from '@front-burner/ui';
import { fieldErrorCode } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import { COMMIT_EMAIL_HELP } from '../../models/commit-author-help';

const KNOWN_CODES: readonly string[] = COMMIT_AUTHOR_FIELD_CODES;

/**
 * The name and email of a commit author (CA-10, CA-11), for the Preferences
 * page and the commit form's dialogs. Whoever shows it owns the form, from
 * `commitAuthorForm`, and the backend's field errors of its last request.
 */
@Component({
  selector: 'dlg-commit-author-form',
  imports: [ TranslocoDirective, FormField, FieldComponent, InputComponent ],
  templateUrl: './commit-author-form.component.html',
  styleUrl: './commit-author-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommitAuthorFormComponent {
  readonly field = input.required<FieldTree<CommitAuthor>>();
  readonly serverErrors = input<FieldError[]>([]);

  protected readonly githubHelp = COMMIT_EMAIL_HELP.github;
  protected readonly bitbucketHelp = COMMIT_EMAIL_HELP.bitbucket;

  /** The keys, relative to `web-repository-dialogs.errors`, of the reasons to show next to the fields. */
  protected readonly fieldErrors = computed((): Record<keyof CommitAuthor, string | undefined> => ({
    name: this.fieldError('name'),
    email: this.fieldError('email')
  }));

  /** The key, relative to `web-repository-dialogs.errors`, of the reason to show next to the field. */
  private fieldError(name: keyof CommitAuthor): string | undefined {
    const code = this.serverErrors().find(error => error.path === name)?.code ?? this.ownCode(name);
    if (code === undefined) {
      return undefined;
    }
    return KNOWN_CODES.includes(code) ? `${name}.${code}` : 'invalid';
  }

  /** The field's first error, once it is touched or the form submitted. */
  private ownCode(name: keyof CommitAuthor): string | undefined {
    const state = this.field()[name]();
    const error: ValidationError | undefined = state.touched() ? state.errors()[0] : undefined;
    return error === undefined ? undefined : fieldErrorCode(error);
  }
}
