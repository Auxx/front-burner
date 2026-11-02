import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { type FieldTree, FormField, type ValidationError } from '@angular/forms/signals';
import { COMMIT_AUTHOR_FIELD_CODES, type CommitAuthor, type FieldError } from '@front-burner/shared-contracts';
import { FieldComponent, InputComponent } from '@front-burner/ui';
import { fieldErrorCode } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

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

  protected readonly githubHelp = 'https://docs.github.com/en/account-and-profile/reference/email-addresses-reference';
  protected readonly bitbucketHelp =
    'https://support.atlassian.com/bitbucket-cloud/docs/configure-your-dvcs-username-for-commits/';

  /** The key, relative to `web-repository-dialogs.errors`, of the reason to show next to the field. */
  protected error(name: keyof CommitAuthor): string | undefined {
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
