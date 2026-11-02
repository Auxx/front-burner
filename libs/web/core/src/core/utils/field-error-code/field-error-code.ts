import type { ValidationError } from '@angular/forms/signals';

/**
 * The code of a form error, in the form the API uses for `FieldError.code`
 * (A-3.9): a schema's own code from `params.code`, else Zod's code with
 * hyphens, else the error's kind.
 */
export function fieldErrorCode(error: ValidationError): string {
  if (error.kind === 'standardSchema' && 'issue' in error) {
    const issue = error.issue as { code?: unknown; params?: { code?: unknown; }; };
    if (typeof issue.params?.code === 'string') {
      return issue.params.code;
    }
    if (typeof issue.code === 'string') {
      return issue.code.replace(/_/g, '-');
    }
  }
  return error.kind;
}
